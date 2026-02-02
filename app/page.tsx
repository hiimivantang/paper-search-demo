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
    // Lexical highlighting: exact word matching
    const regex = new RegExp(`(${words.map(w => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})`, 'gi');
    const parts = text.split(regex);

    return parts.map((part, i) => {
      const isMatch = words.some(w => part.toLowerCase() === w);
      if (isMatch) {
        return (
          <span key={i} className="bg-yellow-200 px-0.5 rounded">
            {part}
          </span>
        );
      }
      return part;
    });
  }

  return text;
}

export default function Home() {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Options
  const [useTimeDecay, setUseTimeDecay] = useState(false);
  const [useBoost, setUseBoost] = useState(false);
  const [highlightMode, setHighlightMode] = useState<HighlightMode>('lexical');
  const [limit, setLimit] = useState(10);

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
  const [origin, setOrigin] = useState(2025);
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

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-4xl mx-auto px-4 py-8">
        <header className="text-center mb-8">
          <h1 className="text-3xl font-bold text-gray-900 mb-2">
            Paper Search Demo
          </h1>
          <p className="text-gray-600">
            Dense vector search with rankers, boosting, and highlighting
          </p>
        </header>

        {/* Search Box */}
        <div className="bg-white rounded-lg shadow-md p-6 mb-6">
          <div className="flex gap-3 mb-4">
            <div className="flex-1 relative">
              <input
                ref={inputRef}
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={handleKeyDown}
                onFocus={() => suggestions.length > 0 && setShowSuggestions(true)}
                onBlur={() => setTimeout(() => setShowSuggestions(false), 150)}
                placeholder="Search for papers (e.g., 'vehicle automation', 'deep learning')"
                className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                autoComplete="off"
              />
              {showSuggestions && suggestions.length > 0 && (
                <ul className="absolute z-10 left-0 right-0 mt-1 bg-white border border-gray-200 rounded-lg shadow-lg max-h-60 overflow-auto">
                  {suggestions.map((title, i) => {
                    const q = query.trim();
                    const idx = title.indexOf(q);
                    return (
                      <li
                        key={i}
                        className={`px-4 py-2 text-sm cursor-pointer ${
                          i === selectedIdx ? 'bg-blue-50 text-blue-700' : 'text-gray-700 hover:bg-gray-50'
                        }`}
                        onMouseDown={() => {
                          setQuery(title);
                          setShowSuggestions(false);
                        }}
                      >
                        {idx >= 0 ? (
                          <>
                            {title.slice(0, idx)}
                            <strong className="font-bold">{title.slice(idx, idx + q.length)}</strong>
                            {title.slice(idx + q.length)}
                          </>
                        ) : title}
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
            <button
              onClick={handleSearch}
              disabled={loading || !query.trim()}
              className="px-6 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:bg-gray-400 disabled:cursor-not-allowed transition-colors"
            >
              {loading ? 'Searching...' : 'Search'}
            </button>
          </div>

          {/* Options */}
          <div className="border-t pt-4">
            <h3 className="text-sm font-medium text-gray-700 mb-3">Search Options</h3>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
              {/* Rankers */}
              <div className="space-y-2">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={useTimeDecay}
                    onChange={(e) => setUseTimeDecay(e.target.checked)}
                    className="w-4 h-4 text-blue-600 rounded focus:ring-blue-500"
                  />
                  <span className="text-sm text-gray-700">Time-based Decay Ranker</span>
                </label>
                <p className="text-xs text-gray-500 ml-6">
                  Prefer recent papers with exponential decay
                </p>
              </div>

              <div className="space-y-2">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={useBoost}
                    onChange={(e) => setUseBoost(e.target.checked)}
                    className="w-4 h-4 text-blue-600 rounded focus:ring-blue-500"
                  />
                  <span className="text-sm text-gray-700">Citation Count Boosting</span>
                </label>
                <p className="text-xs text-gray-500 ml-6">
                  Boost highly cited papers (10-100: 1.1x, 100-1000: 1.2x, 1000+: 1.5x)
                </p>
              </div>
            </div>

            {/* Highlighting */}
            <div className="mb-4">
              <label className="text-sm font-medium text-gray-700 block mb-2">
                Highlighting Mode
              </label>
              <div className="flex gap-4">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="radio"
                    name="highlight"
                    checked={highlightMode === 'none'}
                    onChange={() => setHighlightMode('none')}
                    className="w-4 h-4 text-blue-600 focus:ring-blue-500"
                  />
                  <span className="text-sm text-gray-700">None</span>
                </label>
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="radio"
                    name="highlight"
                    checked={highlightMode === 'lexical'}
                    onChange={() => setHighlightMode('lexical')}
                    className="w-4 h-4 text-blue-600 focus:ring-blue-500"
                  />
                  <span className="text-sm text-gray-700">
                    Lexical <span className="bg-yellow-200 px-1 rounded text-xs">(yellow)</span>
                  </span>
                </label>
              </div>
            </div>

            {/* Results Limit */}
            <div className="flex items-center gap-4 mb-4">
              <label className="text-sm text-gray-700">Results:</label>
              <select
                value={limit}
                onChange={(e) => setLimit(Number(e.target.value))}
                className="px-3 py-1.5 border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                {[5, 10, 15, 20, 25, 50].map(n => (
                  <option key={n} value={n}>{n}</option>
                ))}
              </select>
            </div>

            {/* Advanced Options */}
            {useTimeDecay && (
              <div className="border-t pt-4">
                <button
                  onClick={() => setShowAdvanced(!showAdvanced)}
                  className="text-sm text-blue-600 hover:text-blue-800 mb-3"
                >
                  {showAdvanced ? '- Hide' : '+ Show'} Advanced Time Decay Settings
                </button>

                {showAdvanced && (
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-4 bg-gray-50 p-4 rounded-lg">
                    <div>
                      <label className="block text-xs text-gray-600 mb-1">Origin Year</label>
                      <input
                        type="number"
                        value={origin}
                        onChange={(e) => setOrigin(Number(e.target.value))}
                        className="w-full px-2 py-1 border border-gray-300 rounded text-sm"
                      />
                    </div>
                    <div>
                      <label className="block text-xs text-gray-600 mb-1">Offset (years)</label>
                      <input
                        type="number"
                        value={offset}
                        onChange={(e) => setOffset(Number(e.target.value))}
                        className="w-full px-2 py-1 border border-gray-300 rounded text-sm"
                      />
                    </div>
                    <div>
                      <label className="block text-xs text-gray-600 mb-1">Decay Rate</label>
                      <input
                        type="number"
                        step="0.1"
                        min="0"
                        max="1"
                        value={decay}
                        onChange={(e) => setDecay(Number(e.target.value))}
                        className="w-full px-2 py-1 border border-gray-300 rounded text-sm"
                      />
                    </div>
                    <div>
                      <label className="block text-xs text-gray-600 mb-1">Scale</label>
                      <input
                        type="number"
                        value={scale}
                        onChange={(e) => setScale(Number(e.target.value))}
                        className="w-full px-2 py-1 border border-gray-300 rounded text-sm"
                      />
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>

        {/* Error Display */}
        {error && (
          <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg mb-6">
            {error}
          </div>
        )}

        {/* Results */}
        {results && (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-semibold text-gray-800">
                Results for &ldquo;{results.query}&rdquo;
              </h2>
              <div className="text-sm text-gray-500 flex gap-2">
                {results.options.use_time_decay && (
                  <span className="bg-purple-100 text-purple-700 px-2 py-0.5 rounded">
                    Time Decay
                  </span>
                )}
                {results.options.use_boost && (
                  <span className="bg-orange-100 text-orange-700 px-2 py-0.5 rounded">
                    Citation Boost
                  </span>
                )}
              </div>
            </div>

            {results.papers.length === 0 ? (
              <p className="text-gray-500 text-center py-8">No results found</p>
            ) : (
              <div className="space-y-3">
                {results.papers.map((paper, idx) => (
                  <div
                    key={paper.id || `${paper.corpusid}-${idx}`}
                    className="bg-white rounded-lg shadow p-4 hover:shadow-md transition-shadow"
                  >
                    <div className="flex items-start justify-between gap-4">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1">
                          <span className="text-sm text-gray-400 font-mono">
                            #{idx + 1}
                          </span>
                          <span className="text-xs bg-gray-100 text-gray-600 px-2 py-0.5 rounded">
                            Score: {paper.score.toFixed(4)}
                          </span>
                        </div>
                        <h3 className="font-medium text-gray-900 mb-2">
                          {paper.highlighted_title ? (
                            <span dangerouslySetInnerHTML={{ __html: paper.highlighted_title }} />
                          ) : (
                            highlightText(paper.title, results.query, highlightMode)
                          )}
                        </h3>
                        <div className="flex flex-wrap gap-4 text-sm text-gray-600">
                          <span>
                            Year: <strong>{paper.year}</strong>
                          </span>
                          <span>
                            Citations:{' '}
                            <strong
                              className={
                                paper.citationcount > 1000
                                  ? 'text-green-600'
                                  : paper.citationcount > 100
                                  ? 'text-blue-600'
                                  : ''
                              }
                            >
                              {paper.citationcount.toLocaleString()}
                            </strong>
                          </span>
                        </div>
                      </div>
                      <a
                        href={paper.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-blue-600 hover:text-blue-800 text-sm whitespace-nowrap"
                      >
                        View Paper &rarr;
                      </a>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Info Footer */}
        <footer className="mt-12 text-center text-sm text-gray-500">
          <p>
            Powered by Milvus vector database and OpenAI embeddings
          </p>
          <p className="mt-1">
            Using text-embedding-3-small for dense vector search
          </p>
        </footer>
      </div>
    </div>
  );
}
