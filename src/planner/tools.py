"""
Planner tools: web search (Tavily/DuckDuckGo), page fetch, ArXiv search, GitHub search.
Wrapped as LangChain tools so LangGraph's ToolNode can invoke them.
"""

from __future__ import annotations
import os
import textwrap
import httpx
from langchain_core.tools import tool


@tool
def web_search(query: str) -> str:
    """Search the web. Uses Tavily if TAVILY_API_KEY is set (free tier: 1k/mo), otherwise DuckDuckGo."""
    api_key = os.environ.get("TAVILY_API_KEY", "")
    if api_key:
        try:
            resp = httpx.post(
                "https://api.tavily.com/search",
                json={"query": query, "max_results": 5, "search_depth": "basic"},
                headers={"Authorization": f"Bearer {api_key}"},
                timeout=15,
            )
            resp.raise_for_status()
            items = resp.json().get("results", [])
            if items:
                return "\n---\n".join(
                    f"Title: {r['title']}\nURL: {r['url']}\nSnippet: {r.get('content', '')[:300]}"
                    for r in items
                )
        except Exception:
            pass  # fall through to DuckDuckGo

    from duckduckgo_search import DDGS
    results = []
    with DDGS() as ddgs:
        for r in ddgs.text(query, max_results=5):
            results.append(f"Title: {r['title']}\nURL: {r['href']}\nSnippet: {r['body']}\n")
    return "\n---\n".join(results) if results else "No results found."


@tool
def github_search(query: str) -> str:
    """
    Search GitHub for repositories related to a learning topic.
    Returns repo names, star counts, descriptions, and URLs.
    Great for finding reference implementations, course repos, and tutorials.
    """
    headers = {"Accept": "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28"}
    token = os.environ.get("GITHUB_TOKEN", "")
    if token:
        headers["Authorization"] = f"Bearer {token}"

    try:
        resp = httpx.get(
            "https://api.github.com/search/repositories",
            params={"q": query, "sort": "stars", "order": "desc", "per_page": 5},
            headers=headers,
            timeout=10,
        )
        resp.raise_for_status()
        items = resp.json().get("items", [])
        if not items:
            return "No GitHub repositories found."
        results = []
        for r in items:
            topics = ", ".join(r.get("topics", [])[:5]) or "—"
            results.append(
                f"Repo: {r['full_name']}\n"
                f"Stars: {r['stargazers_count']:,}\n"
                f"Description: {r.get('description') or 'No description'}\n"
                f"Topics: {topics}\n"
                f"URL: {r['html_url']}"
            )
        return "\n---\n".join(results)
    except Exception as e:
        return f"GitHub search failed: {e}"


@tool
def fetch_page(url: str) -> str:
    """Fetch a web page and return its cleaned text content (max 3000 chars)."""
    try:
        resp = httpx.get(url, timeout=15, follow_redirects=True,
                         headers={"User-Agent": "mnemos-planner/0.1"})
        resp.raise_for_status()
    except Exception as e:
        return f"Failed to fetch {url}: {e}"

    from bs4 import BeautifulSoup
    soup = BeautifulSoup(resp.text, "html.parser")
    for tag in soup(["script", "style", "nav", "footer", "header"]):
        tag.decompose()
    text = " ".join(soup.get_text(separator=" ").split())
    return textwrap.shorten(text, width=3000, placeholder=" …[truncated]")


# ArXiv categories that are relevant for CS / ML / AI topics.
# Papers outside these are almost certainly off-topic for a learning roadmap.
_CS_ML_CATS = {
    "cs.LG", "cs.AI", "cs.CL", "cs.CV", "cs.NE", "cs.IR", "cs.HC",
    "cs.RO", "cs.SE", "cs.CR", "stat.ML", "econ.EM", "q-bio.NC",
}

import re as _re


def _clean_arxiv_url(entry_id: str) -> str:
    return _re.sub(r'v\d+$', '', entry_id.replace('http://', 'https://'))


def _is_relevant(paper) -> bool:
    """Return True if the paper belongs to a CS/ML category."""
    cats = set(paper.categories)
    return bool(cats & _CS_ML_CATS)


@tool
def arxiv_search(query: str, categories: str = "cs.LG cs.AI cs.CL stat.ML") -> str:
    """
    Search ArXiv for papers relevant to a learning topic.

    Args:
        query: Search terms — be specific (e.g. 'transformer attention mechanism tutorial').
        categories: Space-separated ArXiv category codes to restrict results.
                    Defaults to CS/ML categories. Use 'cs.CL' for NLP, 'cs.CV' for vision,
                    'cs.LG stat.ML' for general ML. Do NOT change for non-technical topics.

    Returns:
        Titles, authors, abstracts, and stable URLs of relevant papers.
    """
    import arxiv

    # Build a category-scoped query: (user terms) AND (cat:X OR cat:Y ...)
    cat_parts = " OR ".join(f"cat:{c}" for c in categories.split())
    scoped_query = f"({query}) AND ({cat_parts})"

    client = arxiv.Client()
    # fetch extra to allow post-filtering without running out of results
    search = arxiv.Search(
        query=scoped_query,
        max_results=10,
        sort_by=arxiv.SortCriterion.Relevance,
    )

    results = []
    for paper in client.results(search):
        if not _is_relevant(paper):
            continue  # skip physics / bio / math papers
        abstract = textwrap.shorten(paper.summary, width=400, placeholder=" …")
        results.append(
            f"Title: {paper.title}\n"
            f"Categories: {', '.join(paper.categories)}\n"
            f"Authors: {', '.join(a.name for a in paper.authors[:3])}\n"
            f"Published: {paper.published.strftime('%Y-%m')}\n"
            f"URL: {_clean_arxiv_url(paper.entry_id)}\n"
            f"Abstract: {abstract}"
        )
        if len(results) == 4:
            break

    if not results:
        # Fallback: retry without the category constraint — better than returning nothing
        fallback = arxiv.Search(query=query, max_results=4, sort_by=arxiv.SortCriterion.Relevance)
        for paper in client.results(fallback):
            abstract = textwrap.shorten(paper.summary, width=400, placeholder=" …")
            results.append(
                f"Title: {paper.title}\n"
                f"Categories: {', '.join(paper.categories)}\n"
                f"Authors: {', '.join(a.name for a in paper.authors[:3])}\n"
                f"Published: {paper.published.strftime('%Y-%m')}\n"
                f"URL: {_clean_arxiv_url(paper.entry_id)}\n"
                f"Abstract: {abstract}"
            )
            if len(results) == 4:
                break

    return "\n---\n".join(results) if results else "No ArXiv papers found."


PLANNER_TOOLS = [web_search, fetch_page, arxiv_search, github_search]
