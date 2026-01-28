# Paper Search Demo

A Next.js/React demo application that showcases Milvus vector search capabilities with semantic scholar papers. This demo mirrors the functionality from the Jupyter notebook, including:

- **Dense Vector Search**: Using OpenAI text-embedding-3-small embeddings
- **Lexical Highlighting**: Highlight exact word matches in yellow (BM25 search)
- **Semantic Highlighting**: Highlight semantically related terms in green
- **Time-based Decay Ranker**: Prefer recent papers with exponential decay
- **Citation Count Boosting**: Boost papers based on citation counts

## Architecture

```
┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐
│   Next.js UI    │────▶│ Python Serverless│────▶│  Milvus/Zilliz  │
│   (Vercel)      │     │   (/api/search) │     │    Cloud        │
└─────────────────┘     └─────────────────┘     └─────────────────┘
                               │
                               ▼
                        ┌─────────────────┐
                        │   OpenAI API    │
                        │  (Embeddings)   │
                        └─────────────────┘
```

## Deploy to Vercel

### 1. Push to GitHub

```bash
git init
git add .
git commit -m "Initial commit"
git remote add origin https://github.com/YOUR_USERNAME/paper-search-demo.git
git push -u origin main
```

### 2. Import to Vercel

1. Go to [vercel.com](https://vercel.com) and sign in
2. Click "Add New Project"
3. Import your GitHub repository
4. Configure environment variables:

| Variable | Description |
|----------|-------------|
| `OPENAI_API_KEY` | Your OpenAI API key |
| `MILVUS_URI` | Zilliz Cloud cluster URI |
| `MILVUS_TOKEN` | Zilliz Cloud API token |
| `SEMANTIC_HIGHLIGHTER_MODEL_ID` | (Optional) Model deployment ID for semantic highlighting |

5. Click "Deploy"

### 3. Done!

Your app will be live at `https://your-project.vercel.app`

## Local Development

### Prerequisites

- Node.js 18+
- Python 3.10+
- OpenAI API key

### Setup

```bash
# Install Node.js dependencies
npm install

# Install Python dependencies (for local backend)
pip install -r backend/requirements.txt
```

### Configure Environment

Create a `.env.local` file:

```env
OPENAI_API_KEY=your_openai_api_key_here
MILVUS_URI=https://your-cluster.vectordb.zillizcloud.com:19541
MILVUS_TOKEN=your_milvus_token_here
```

### Run Locally

**Option 1: Using the FastAPI backend (recommended for development)**

```bash
# Terminal 1: Start Python backend
cd backend
python main.py

# Terminal 2: Start Next.js frontend
npm run dev
```

**Option 2: Using Vercel CLI (simulates production)**

```bash
npm i -g vercel
vercel dev
```

## Usage

1. Open http://localhost:3000 in your browser
2. Enter a search query (e.g., "vehicle automation", "deep learning")
3. Configure search options:
   - **Time-based Decay Ranker**: Prefer recent papers
   - **Citation Count Boosting**: Boost highly-cited papers
   - **Highlighting Mode**: None, Lexical (yellow), or Semantic (green)
4. Click Search or press Enter

## Search Options

### Highlighting Modes

| Mode | Search Type | Description |
|------|-------------|-------------|
| **Lexical** | BM25 Sparse | Exact keyword matching with yellow highlights |
| **Semantic** | Dense Vector | Meaning-based search with green highlights |
| **None** | Dense Vector | No highlighting |

### Time-based Decay Ranker

Uses exponential decay to prefer recent papers:
- **Origin Year**: Reference year (default: 2025)
- **Offset**: Years before decay starts (default: 5)
- **Decay Rate**: Decay factor (default: 0.8)
- **Scale**: Decay scale (default: 8)

### Citation Count Boosting

- Citations 10-100: 1.1x boost
- Citations 100-1000: 1.2x boost
- Citations 1000+: 1.5x boost

## Tech Stack

- **Frontend**: Next.js 16, React, Tailwind CSS
- **Backend**: Python serverless functions (Vercel)
- **Database**: Milvus/Zilliz Cloud
- **Embeddings**: OpenAI text-embedding-3-small
- **Search**: Dense vector search + BM25 sparse search
