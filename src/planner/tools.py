"""
Planner tools: web search (DuckDuckGo), page fetch, ArXiv search.
Wrapped as LangChain tools so LangGraph's ToolNode can invoke them.
"""

from __future__ import annotations
import textwrap
import httpx
from langchain_core.tools import tool


@tool
def web_search(query: str) -> str:
    """Search the web with DuckDuckGo. Returns titles, URLs, and snippets."""
    from duckduckgo_search import DDGS
    results = []
    with DDGS() as ddgs:
        for r in ddgs.text(query, max_results=5):
            results.append(f"Title: {r['title']}\nURL: {r['href']}\nSnippet: {r['body']}\n")
    return "\n---\n".join(results) if results else "No results found."


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
    soup = BeautifulSoup(resp.text, "lxml")
    for tag in soup(["script", "style", "nav", "footer", "header"]):
        tag.decompose()
    text = " ".join(soup.get_text(separator=" ").split())
    return textwrap.shorten(text, width=3000, placeholder=" …[truncated]")


@tool
def arxiv_search(query: str) -> str:
    """Search ArXiv for papers relevant to a learning topic. Returns titles, authors, abstracts."""
    import arxiv
    client = arxiv.Client()
    search = arxiv.Search(query=query, max_results=4, sort_by=arxiv.SortCriterion.Relevance)
    results = []
    for paper in client.results(search):
        abstract = textwrap.shorten(paper.summary, width=400, placeholder=" …")
        results.append(
            f"Title: {paper.title}\n"
            f"Authors: {', '.join(a.name for a in paper.authors[:3])}\n"
            f"Published: {paper.published.strftime('%Y-%m')}\n"
            f"URL: {paper.entry_id}\n"
            f"Abstract: {abstract}"
        )
    return "\n---\n".join(results) if results else "No ArXiv papers found."


PLANNER_TOOLS = [web_search, fetch_page, arxiv_search]
