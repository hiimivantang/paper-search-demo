'use client';

import { useState, useCallback, useEffect, useRef } from 'react';

interface Paper {
  id: string;
  score: number;
  corpusid: number;
  title: string;
  highlighted_title?: string | null;
  year: number;
  citationcount: number;
  url: string;
}

interface SearchResult {
  success: boolean;
  query: string;
  papers: Paper[];
  options: {
    use_time_decay: boolean;
    use_boost: boolean;
    highlight_mode?: string;
    limit: number;
  };
}

type HighlightMode = 'none' | 'lexical';

function highlightText(
  text: string,
  query: string,
  mode: HighlightMode
): React.ReactNode {
  if (mode === 'none' || !query.trim()) {
    return text;
  }

  const words = query.toLowerCase().split(/\s+/).filter(Boolean);

  if (mode === 'lexical') {
    const regex = new RegExp(`(${words.map(w => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})`, 'gi');
    const parts = text.split(regex);

    return parts.map((part, i) => {
      const isMatch = words.some(w => part.toLowerCase() === w);
      if (isMatch) {
        return (
          <span key={i} className="bg-yellow-200/80 px-0.5 rounded-sm">
            {part}
          </span>
        );
      }
      return part;
    });
  }

  return text;
}

function SearchIcon({ className }: { className?: string }) {
  return (
    <svg className={className} xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor">
      <path fillRule="evenodd" d="M9 3.5a5.5 5.5 0 100 11 5.5 5.5 0 000-11zM2 9a7 7 0 1112.452 4.391l3.328 3.329a.75.75 0 11-1.06 1.06l-3.329-3.328A7 7 0 012 9z" clipRule="evenodd" />
    </svg>
  );
}

function ChevronIcon({ open, className }: { open: boolean; className?: string }) {
  return (
    <svg
      className={`${className} transition-transform duration-200 ${open ? 'rotate-180' : ''}`}
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 20 20"
      fill="currentColor"
    >
      <path fillRule="evenodd" d="M5.22 8.22a.75.75 0 0 1 1.06 0L10 11.94l3.72-3.72a.75.75 0 1 1 1.06 1.06l-4.25 4.25a.75.75 0 0 1-1.06 0L5.22 9.28a.75.75 0 0 1 0-1.06Z" clipRule="evenodd" />
    </svg>
  );
}

function LoadingSpinner() {
  return (
    <div className="flex flex-col items-center justify-center py-16 gap-4">
      <div className="relative">
        <div className="w-10 h-10 border-3 border-blue-200 rounded-full" />
        <div className="absolute top-0 left-0 w-10 h-10 border-3 border-transparent border-t-blue-600 rounded-full animate-spin-slow" />
      </div>
      <div className="flex gap-1.5">
        <span className="w-1.5 h-1.5 bg-blue-400 rounded-full animate-pulse-dot" />
        <span className="w-1.5 h-1.5 bg-blue-400 rounded-full animate-pulse-dot" style={{ animationDelay: '0.2s' }} />
        <span className="w-1.5 h-1.5 bg-blue-400 rounded-full animate-pulse-dot" style={{ animationDelay: '0.4s' }} />
      </div>
      <p className="text-sm text-slate-400 font-medium">Searching papers...</p>
    </div>
  );
}

function getReaderUrl(paperUrl: string): string {
  try {
    const url = new URL(paperUrl);
    const segments = url.pathname.split('/').filter(Boolean);
    if (segments.length >= 3 && segments[0] === 'paper') {
      return `https://www.semanticscholar.org/reader/${segments[segments.length - 1]}`;
    }
  } catch { /* fallback below */ }
  return paperUrl;
}

function formatCitations(count: number): string {
  if (count >= 1000) {
    return `${(count / 1000).toFixed(count >= 10000 ? 0 : 1)}k`;
  }
  return count.toLocaleString();
}

export default function Home() {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Options
  const [useTimeDecay, setUseTimeDecay] = useState(false);
  const [useBoost, setUseBoost] = useState(false);
  const [highlightMode, setHighlightMode] = useState<HighlightMode>('none');
  const [limit, setLimit] = useState(10);
  const [viewingPaper, setViewingPaper] = useState<Paper | null>(null);
  const [showOptions, setShowOptions] = useState(false);

  // Autocomplete
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [selectedIdx, setSelectedIdx] = useState(-1);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (query.trim().length < 4) {
      setSuggestions([]);
      setShowSuggestions(false);
      return;
    }
    debounceRef.current = setTimeout(async () => {
      try {
        const res = await fetch('/api/autocomplete', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ query: query.trim(), limit: 5 }),
        });
        const data = await res.json();
        setSuggestions(data.titles || []);
        setShowSuggestions((data.titles || []).length > 0);
        setSelectedIdx(-1);
      } catch {
        setSuggestions([]);
      }
    }, 200);
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  }, [query]);

  // Advanced time decay parameters
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [origin, setOrigin] = useState(2026);
  const [offset, setOffset] = useState(5);
  const [decay, setDecay] = useState(0.8);
  const [scale, setScale] = useState(8);

  const handleSearch = useCallback(async () => {
    if (!query.trim()) return;

    setLoading(true);
    setError(null);

    try {
      const response = await fetch('/api/search', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          query: query.trim(),
          limit,
          use_time_decay: useTimeDecay,
          use_boost: useBoost,
          highlight_mode: highlightMode,
          time_decay_params: useTimeDecay ? { origin, offset, decay, scale } : undefined,
        }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Search failed');
      }

      const data = await response.json();
      setResults(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An error occurred');
    } finally {
      setLoading(false);
    }
  }, [query, limit, useTimeDecay, useBoost, highlightMode, origin, offset, decay, scale]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (showSuggestions && suggestions.length > 0) {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setSelectedIdx(prev => (prev + 1) % suggestions.length);
        return;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        setSelectedIdx(prev => (prev - 1 + suggestions.length) % suggestions.length);
        return;
      }
      if (e.key === 'Enter' && selectedIdx >= 0) {
        e.preventDefault();
        setQuery(suggestions[selectedIdx]);
        setShowSuggestions(false);
        return;
      }
      if (e.key === 'Escape') {
        setShowSuggestions(false);
        return;
      }
    }
    if (e.key === 'Enter') {
      setShowSuggestions(false);
      handleSearch();
    }
  };

  const activeOptionsCount = [useTimeDecay, useBoost, highlightMode !== 'none'].filter(Boolean).length;

  return (
    <div className={`min-h-screen bg-slate-50 transition-[margin] duration-300 ${viewingPaper ? 'mr-[50vw]' : ''}`}>
      {/* Header */}
      <div className="bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 text-white">
        <div className="max-w-3xl mx-auto px-4 pt-12 pb-16">
          <div className="text-center mb-8">
            <h1 className="text-4xl font-bold tracking-tight mb-3">
              <span className="gradient-text">Paper Search</span>
            </h1>
            <p className="text-slate-400 text-base max-w-lg mx-auto">
              Powered by <span className="text-blue-400 font-medium">Milvus 2.6</span> &mdash; semantic search, full text search, decay &amp; boost rankers
            </p>
          </div>

          {/* Search Box */}
          <div className="relative max-w-2xl mx-auto">
            <div className="relative">
              <SearchIcon className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-400" />
              <input
                ref={inputRef}
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={handleKeyDown}
                onFocus={() => suggestions.length > 0 && setShowSuggestions(true)}
                onBlur={() => setTimeout(() => setShowSuggestions(false), 150)}
                placeholder="Search for papers..."
                className="w-full pl-12 pr-28 py-4 bg-white/10 border border-white/20 rounded-xl text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500/50 focus:border-white/30 focus:bg-white/[0.12] backdrop-blur-sm text-base"
                autoComplete="off"
              />
              <button
                onClick={handleSearch}
                disabled={loading || !query.trim()}
                className="absolute right-2 top-1/2 -translate-y-1/2 px-5 py-2.5 bg-blue-600 text-white rounded-lg font-medium text-sm hover:bg-blue-500 disabled:bg-slate-600 disabled:text-slate-400 disabled:cursor-not-allowed"
              >
                Search
              </button>
            </div>

            {/* Autocomplete dropdown */}
            {showSuggestions && suggestions.length > 0 && (
              <ul className="absolute z-20 left-0 right-0 mt-2 bg-white border border-slate-200 rounded-xl shadow-xl overflow-hidden custom-scrollbar max-h-64 overflow-auto">
                {suggestions.map((title, i) => {
                  const q = query.trim();
                  const idx = title.indexOf(q);
                  return (
                    <li
                      key={i}
                      className={`px-4 py-3 text-sm cursor-pointer border-b border-slate-50 last:border-0 flex items-center gap-3 ${
                        i === selectedIdx
                          ? 'bg-blue-50 text-blue-900'
                          : 'text-slate-700 hover:bg-slate-50'
                      }`}
                      onMouseDown={() => {
                        setQuery(title);
                        setShowSuggestions(false);
                      }}
                    >
                      <SearchIcon className={`w-3.5 h-3.5 flex-shrink-0 ${i === selectedIdx ? 'text-blue-400' : 'text-slate-300'}`} />
                      <span className="truncate">
                        {idx >= 0 ? (
                          <>
                            {title.slice(0, idx)}
                            <strong className="font-semibold text-blue-600">{title.slice(idx, idx + q.length)}</strong>
                            {title.slice(idx + q.length)}
                          </>
                        ) : title}
                      </span>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </div>
      </div>

      <div className="max-w-3xl mx-auto px-4 -mt-4">
        {/* Options Toggle */}
        <div className="bg-white rounded-xl shadow-sm border border-slate-200/80 mb-6 overflow-hidden">
          <button
            onClick={() => setShowOptions(!showOptions)}
            className="w-full flex items-center justify-between px-5 py-3.5 hover:bg-slate-50 text-left"
          >
            <div className="flex items-center gap-3">
              <svg className="w-4 h-4 text-slate-400" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor">
                <path d="M17 2.75a.75.75 0 0 0-1.5 0v5.5a.75.75 0 0 0 1.5 0v-5.5ZM17 15.75a.75.75 0 0 0-1.5 0v1.5a.75.75 0 0 0 1.5 0v-1.5ZM3.75 15a.75.75 0 0 1 .75.75v1.5a.75.75 0 0 1-1.5 0v-1.5a.75.75 0 0 1 .75-.75ZM4.5 2.75a.75.75 0 0 0-1.5 0v5.5a.75.75 0 0 0 1.5 0v-5.5ZM10 11a.75.75 0 0 1 .75.75v5.5a.75.75 0 0 1-1.5 0v-5.5A.75.75 0 0 1 10 11ZM10.75 2.75a.75.75 0 0 0-1.5 0v1.5a.75.75 0 0 0 1.5 0v-1.5ZM10 5a2 2 0 1 0 0 4 2 2 0 0 0 0-4ZM3.75 10a2 2 0 1 0 0 4 2 2 0 0 0 0-4ZM16.25 10a2 2 0 1 0 0 4 2 2 0 0 0 0-4Z" />
              </svg>
              <span className="text-sm font-medium text-slate-700">Search Options</span>
              {activeOptionsCount > 0 && (
                <span className="text-xs bg-blue-100 text-blue-700 px-2 py-0.5 rounded-full font-medium">
                  {activeOptionsCount} active
                </span>
              )}
            </div>
            <ChevronIcon open={showOptions} className="w-4 h-4 text-slate-400" />
          </button>

          {showOptions && (
            <div className="px-5 pb-5 border-t border-slate-100">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-4">
                {/* Rankers */}
                <label className="flex items-start gap-3 cursor-pointer group p-3 rounded-lg hover:bg-slate-50 -m-1">
                  <input
                    type="checkbox"
                    checked={useTimeDecay}
                    onChange={(e) => setUseTimeDecay(e.target.checked)}
                    className="w-4 h-4 text-blue-600 rounded focus:ring-blue-500 mt-0.5"
                  />
                  <div>
                    <span className="text-sm font-medium text-slate-700 group-hover:text-slate-900">Decay Ranker</span>
                    <p className="text-xs text-slate-400 mt-0.5">Milvus 2.6 &mdash; prefer recent papers with exponential decay</p>
                  </div>
                </label>

                <label className="flex items-start gap-3 cursor-pointer group p-3 rounded-lg hover:bg-slate-50 -m-1">
                  <input
                    type="checkbox"
                    checked={useBoost}
                    onChange={(e) => setUseBoost(e.target.checked)}
                    className="w-4 h-4 text-blue-600 rounded focus:ring-blue-500 mt-0.5"
                  />
                  <div>
                    <span className="text-sm font-medium text-slate-700 group-hover:text-slate-900">Boost Ranker</span>
                    <p className="text-xs text-slate-400 mt-0.5">Milvus 2.6 &mdash; boost highly-cited papers (1.1x&ndash;1.5x)</p>
                  </div>
                </label>
              </div>

              {/* Highlighting & Limit */}
              <div className="flex flex-wrap items-center gap-x-6 gap-y-3 mt-4 pt-4 border-t border-slate-100">
                <div className="flex items-center gap-3">
                  <span className="text-sm text-slate-500">Highlight:</span>
                  <div className="flex bg-slate-100 rounded-lg p-0.5">
                    <button
                      onClick={() => setHighlightMode('none')}
                      className={`px-3 py-1 text-xs font-medium rounded-md ${
                        highlightMode === 'none'
                          ? 'bg-white text-slate-700 shadow-sm'
                          : 'text-slate-500 hover:text-slate-700'
                      }`}
                    >
                      None
                    </button>
                    <button
                      onClick={() => setHighlightMode('lexical')}
                      className={`px-3 py-1 text-xs font-medium rounded-md ${
                        highlightMode === 'lexical'
                          ? 'bg-white text-slate-700 shadow-sm'
                          : 'text-slate-500 hover:text-slate-700'
                      }`}
                    >
                      Lexical
                    </button>
                  </div>
                  {highlightMode === 'lexical' && (
                    <span className="text-xs bg-amber-50 text-amber-700 border border-amber-200 px-2 py-0.5 rounded-full font-medium">
                      Full Text Search (BM25)
                    </span>
                  )}
                </div>

                <div className="flex items-center gap-2">
                  <span className="text-sm text-slate-500">Results:</span>
                  <select
                    value={limit}
                    onChange={(e) => setLimit(Number(e.target.value))}
                    className="px-2.5 py-1 border border-slate-200 rounded-lg text-sm text-slate-700 bg-white focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-300"
                  >
                    {[5, 10, 15, 20, 25, 50].map(n => (
                      <option key={n} value={n}>{n}</option>
                    ))}
                  </select>
                </div>
              </div>

              {/* Advanced Options */}
              {useTimeDecay && (
                <div className="mt-4 pt-4 border-t border-slate-100">
                  <button
                    onClick={() => setShowAdvanced(!showAdvanced)}
                    className="text-xs text-blue-600 hover:text-blue-700 font-medium flex items-center gap-1"
                  >
                    <ChevronIcon open={showAdvanced} className="w-3 h-3" />
                    Advanced Decay Settings
                  </button>

                  {showAdvanced && (
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mt-3 bg-slate-50 p-4 rounded-lg">
                      <div>
                        <label className="block text-xs text-slate-500 mb-1 font-medium">Origin Year</label>
                        <input
                          type="number"
                          value={origin}
                          onChange={(e) => setOrigin(Number(e.target.value))}
                          className="w-full px-2.5 py-1.5 border border-slate-200 rounded-lg text-sm bg-white focus:ring-2 focus:ring-blue-500/30 focus:border-blue-300"
                        />
                      </div>
                      <div>
                        <label className="block text-xs text-slate-500 mb-1 font-medium">Offset (years)</label>
                        <input
                          type="number"
                          value={offset}
                          onChange={(e) => setOffset(Number(e.target.value))}
                          className="w-full px-2.5 py-1.5 border border-slate-200 rounded-lg text-sm bg-white focus:ring-2 focus:ring-blue-500/30 focus:border-blue-300"
                        />
                      </div>
                      <div>
                        <label className="block text-xs text-slate-500 mb-1 font-medium">Decay Rate</label>
                        <input
                          type="number"
                          step="0.1"
                          min="0"
                          max="1"
                          value={decay}
                          onChange={(e) => setDecay(Number(e.target.value))}
                          className="w-full px-2.5 py-1.5 border border-slate-200 rounded-lg text-sm bg-white focus:ring-2 focus:ring-blue-500/30 focus:border-blue-300"
                        />
                      </div>
                      <div>
                        <label className="block text-xs text-slate-500 mb-1 font-medium">Scale</label>
                        <input
                          type="number"
                          value={scale}
                          onChange={(e) => setScale(Number(e.target.value))}
                          className="w-full px-2.5 py-1.5 border border-slate-200 rounded-lg text-sm bg-white focus:ring-2 focus:ring-blue-500/30 focus:border-blue-300"
                        />
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Error Display */}
        {error && (
          <div className="flex items-start gap-3 bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-xl mb-6">
            <svg className="w-5 h-5 text-red-400 flex-shrink-0 mt-0.5" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor">
              <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-8-5a.75.75 0 01.75.75v4.5a.75.75 0 01-1.5 0v-4.5A.75.75 0 0110 5zm0 10a1 1 0 100-2 1 1 0 000 2z" clipRule="evenodd" />
            </svg>
            <p className="text-sm">{error}</p>
          </div>
        )}

        {/* Loading */}
        {loading && <LoadingSpinner />}

        {/* Results */}
        {!loading && results && (
          <div className="pb-12">
            <div className="flex items-center justify-between mb-5">
              <div className="flex items-baseline gap-2">
                <h2 className="text-lg font-semibold text-slate-800">
                  Results
                </h2>
                <span className="text-sm text-slate-400">
                  {results.papers.length} paper{results.papers.length !== 1 ? 's' : ''} for &ldquo;{results.query}&rdquo;
                </span>
              </div>
              <div className="flex gap-1.5 flex-wrap">
                {results.options.highlight_mode === 'lexical' ? (
                  <span className="inline-flex items-center gap-1 text-xs font-medium bg-amber-50 text-amber-700 border border-amber-200 px-2.5 py-1 rounded-full">
                    <svg className="w-3 h-3" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor">
                      <path fillRule="evenodd" d="M4.5 2A1.5 1.5 0 003 3.5v13A1.5 1.5 0 004.5 18h11a1.5 1.5 0 001.5-1.5V7.621a1.5 1.5 0 00-.44-1.06l-4.12-4.122A1.5 1.5 0 0011.378 2H4.5zM14 11.75a.75.75 0 00-.75-.75h-6.5a.75.75 0 000 1.5h6.5a.75.75 0 00.75-.75zm-1-3.5a.75.75 0 00-.75-.75h-4.5a.75.75 0 000 1.5h4.5a.75.75 0 00.75-.75z" clipRule="evenodd" />
                    </svg>
                    Full Text Search
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1 text-xs font-medium bg-blue-50 text-blue-700 border border-blue-200 px-2.5 py-1 rounded-full">
                    <svg className="w-3 h-3" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor">
                      <path d="M10 1a6 6 0 00-3.815 10.631C7.237 12.5 8 13.443 8 14.456v.644a.75.75 0 00.75.75h2.5a.75.75 0 00.75-.75v-.644c0-1.013.762-1.957 1.815-2.825A6 6 0 0010 1zM8.863 17.414a.75.75 0 00-.226 1.483 9.066 9.066 0 002.726 0 .75.75 0 00-.226-1.483 7.563 7.563 0 01-2.274 0z" />
                    </svg>
                    Semantic Search
                  </span>
                )}
                {results.options.use_time_decay && (
                  <span className="inline-flex items-center gap-1 text-xs font-medium bg-violet-50 text-violet-700 border border-violet-200 px-2.5 py-1 rounded-full">
                    <svg className="w-3 h-3" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor">
                      <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm.75-13a.75.75 0 00-1.5 0v5c0 .414.336.75.75.75h4a.75.75 0 000-1.5h-3.25V5z" clipRule="evenodd" />
                    </svg>
                    Decay Ranker
                  </span>
                )}
                {results.options.use_boost && (
                  <span className="inline-flex items-center gap-1 text-xs font-medium bg-amber-50 text-amber-700 border border-amber-200 px-2.5 py-1 rounded-full">
                    <svg className="w-3 h-3" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor">
                      <path fillRule="evenodd" d="M12.577 4.878a.75.75 0 01.919-.53l4.78 1.281a.75.75 0 01.531.919l-1.281 4.78a.75.75 0 01-1.449-.387l.81-3.022a19.407 19.407 0 00-5.594 5.203.75.75 0 01-1.139.093L7 10.06l-4.72 4.72a.75.75 0 01-1.06-1.06l5.25-5.25a.75.75 0 011.06 0l3.074 3.073a20.923 20.923 0 015.545-4.931l-3.042.815a.75.75 0 01-.53-.919z" clipRule="evenodd" />
                    </svg>
                    Boost Ranker
                  </span>
                )}
              </div>
            </div>

            {results.papers.length === 0 ? (
              <div className="text-center py-16">
                <svg className="w-12 h-12 text-slate-300 mx-auto mb-4" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" d="m21 21-5.197-5.197m0 0A7.5 7.5 0 1 0 5.196 5.196a7.5 7.5 0 0 0 10.607 10.607Z" />
                </svg>
                <p className="text-slate-500 font-medium">No papers found</p>
                <p className="text-sm text-slate-400 mt-1">Try a different search query</p>
              </div>
            ) : (
              <div className="space-y-3">
                {results.papers.map((paper, idx) => (
                  <div
                    key={paper.id || `${paper.corpusid}-${idx}`}
                    className="animate-slide-up bg-white rounded-xl border border-slate-200/80 p-5 hover:border-slate-300 hover:shadow-md group"
                    style={{ animationDelay: `${idx * 50}ms` }}
                  >
                    <div className="flex items-start justify-between gap-4">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-2">
                          <span className="text-xs text-slate-400 font-mono tabular-nums">
                            #{idx + 1}
                          </span>
                          <span className="text-[11px] bg-slate-100 text-slate-500 px-2 py-0.5 rounded-md font-mono tabular-nums">
                            {paper.score.toFixed(4)}
                          </span>
                        </div>
                        <h3 className="font-medium text-slate-900 leading-snug mb-2.5 group-hover:text-blue-900">
                          {paper.highlighted_title ? (
                            <span dangerouslySetInnerHTML={{ __html: paper.highlighted_title }} />
                          ) : (
                            highlightText(paper.title, results.query, highlightMode)
                          )}
                        </h3>
                        <div className="flex flex-wrap items-center gap-3 text-sm">
                          <span className="inline-flex items-center gap-1.5 text-slate-500">
                            <svg className="w-3.5 h-3.5" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor">
                              <path fillRule="evenodd" d="M5.75 2a.75.75 0 01.75.75V4h7V2.75a.75.75 0 011.5 0V4h.25A2.75 2.75 0 0118 6.75v8.5A2.75 2.75 0 0115.25 18H4.75A2.75 2.75 0 012 15.25v-8.5A2.75 2.75 0 014.75 4H5V2.75A.75.75 0 015.75 2z" clipRule="evenodd" />
                            </svg>
                            {paper.year}
                          </span>
                          <span className={`inline-flex items-center gap-1.5 font-medium ${
                            paper.citationcount > 1000
                              ? 'text-emerald-600'
                              : paper.citationcount > 100
                              ? 'text-blue-600'
                              : 'text-slate-500'
                          }`}>
                            <svg className="w-3.5 h-3.5" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor">
                              <path d="M3.505 2.365A41.369 41.369 0 019 2c1.863 0 3.697.124 5.495.365 1.247.167 2.18 1.108 2.435 2.268a4.45 4.45 0 00-.577-.069 43.141 43.141 0 00-4.706 0C9.229 4.696 7.5 6.727 7.5 8.998v2.24c0 1.413.67 2.735 1.76 3.562l-2.98 2.98A.75.75 0 015 17.25v-3.443c-.501-.048-1-.106-1.495-.172C2.033 13.438 1 12.162 1 10.72V5.28c0-1.441 1.033-2.717 2.505-2.914z" />
                              <path d="M14 6c.762 0 1.52.02 2.272.062 1.057.062 1.978.93 1.978 2.11v5.064c0 1.18-.921 2.048-1.978 2.11a40 40 0 01-1.554.065c.014.158.014.318 0 .476l-.004.048c-.017.219-.04.442-.07.666-.114.867-.358 1.783-.752 2.56a.75.75 0 01-1.329-.068c-.344-.753-.558-1.503-.673-2.172a28.4 28.4 0 01-.192-1.335l-.004-.04c-.638-.198-1.22-.56-1.693-1.05V8.998c0-1.566 1.164-2.913 2.772-3.035A41.2 41.2 0 0114 6z" />
                            </svg>
                            {formatCitations(paper.citationcount)}
                          </span>
                        </div>
                      </div>
                      <button
                        onClick={() => setViewingPaper(paper)}
                        className="flex items-center gap-1.5 text-sm text-blue-600 hover:text-blue-700 font-medium whitespace-nowrap opacity-60 group-hover:opacity-100 mt-1"
                      >
                        View
                        <svg className="w-3.5 h-3.5" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor">
                          <path d="M10 12.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5Z" />
                          <path fillRule="evenodd" d="M.664 10.59a1.651 1.651 0 0 1 0-1.186A10.004 10.004 0 0 1 10 3c4.257 0 7.893 2.66 9.336 6.41.147.381.146.804 0 1.186A10.004 10.004 0 0 1 10 17c-4.257 0-7.893-2.66-9.336-6.41ZM14 10a4 4 0 1 1-8 0 4 4 0 0 1 8 0Z" clipRule="evenodd" />
                        </svg>
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Empty state - no search yet */}
        {!loading && !results && !error && (
          <div className="text-center py-20">
            <div className="w-16 h-16 mx-auto mb-5 rounded-2xl bg-gradient-to-br from-blue-100 to-violet-100 flex items-center justify-center">
              <SearchIcon className="w-7 h-7 text-blue-500" />
            </div>
            <p className="text-slate-500 font-medium">Enter a query to search academic papers</p>
            <p className="text-sm text-slate-400 mt-1.5">
              Try &ldquo;deep learning&rdquo;, &ldquo;vehicle automation&rdquo;, or &ldquo;natural language processing&rdquo;
            </p>
          </div>
        )}

        {/* Footer */}
        <footer className="py-8 mt-8 border-t border-slate-200 text-center">
          <p className="text-xs text-slate-400">
            Powered by <span className="font-medium text-slate-500">Milvus 2.6</span> vector database
            &nbsp;&middot;&nbsp;
            <span className="font-medium text-slate-500">OpenAI</span> text-embedding-3-small
          </p>
          <p className="text-[10px] text-slate-300 mt-1">
            Semantic search &middot; Full text search (BM25) &middot; Decay ranker &middot; Boost ranker &middot; Lexical highlighting
          </p>
        </footer>
      </div>

      {/* Paper Viewer Pane */}
      {viewingPaper && (
        <div className="fixed top-0 right-0 w-[50vw] h-screen bg-white border-l border-slate-200 z-50 flex flex-col shadow-2xl animate-slide-in-right">
          <div className="flex items-center justify-between px-4 py-3 border-b border-slate-200 bg-slate-50 flex-shrink-0">
            <div className="min-w-0 flex-1 mr-4">
              <h3 className="font-medium text-slate-800 text-sm truncate">{viewingPaper.title}</h3>
              <p className="text-xs text-slate-400 mt-0.5">Semantic Reader</p>
            </div>
            <div className="flex items-center gap-3 flex-shrink-0">
              <a
                href={getReaderUrl(viewingPaper.url)}
                target="_blank"
                rel="noopener noreferrer"
                className="text-xs text-blue-600 hover:text-blue-700 font-medium"
              >
                Open in new tab
              </a>
              <button
                onClick={() => setViewingPaper(null)}
                className="p-1.5 rounded-lg hover:bg-slate-200 text-slate-400 hover:text-slate-600"
              >
                <svg className="w-4 h-4" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor">
                  <path d="M6.28 5.22a.75.75 0 00-1.06 1.06L8.94 10l-3.72 3.72a.75.75 0 101.06 1.06L10 11.06l3.72 3.72a.75.75 0 101.06-1.06L11.06 10l3.72-3.72a.75.75 0 00-1.06-1.06L10 8.94 6.28 5.22z" />
                </svg>
              </button>
            </div>
          </div>
          <iframe
            src={getReaderUrl(viewingPaper.url)}
            className="flex-1 w-full border-0"
            title={`Reading: ${viewingPaper.title}`}
            allow="fullscreen"
          />
        </div>
      )}
    </div>
  );
}
