AI-powered travel planning assistant built on Cloudflare Workers AI. Chat with an intelligent assistant that remembers your preferences and helps plan personalized trips.

## Features

- **AI-Powered Chat**: Uses Llama 3.3 for natural conversation
- **Memory & Personalization**: Remembers your travel preferences, style, and past trips
- **Smart Itineraries**: Generates day-by-day travel plans based on your interests
- **Persistent Storage**: Uses Durable Objects to store your conversation history and saved trips

## Tech Stack

- **LLM**: Llama 3.3 (via Cloudflare Workers AI)
- **Coordination**: Cloudflare Workers
- **Memory/State**: Cloudflare Durable Objects
- **User Input**: Chat interface
- **Deployment**: Cloudflare Pages/Workers

## 🌐 Live Demo

**Try it now:** [https://travel-planner.valnwankwo20.workers.dev](https://travel-planner.valnwankwo20.workers.dev)

No installation needed - just click and start planning your trip!

---

## Quick Start

### Prerequisites

- Node.js 16.13 or higher
- A Cloudflare account (free tier works)

### Installation

1. Clone the repository:

```bash
git clone <your-repo-url>
cd cf_ai_travel_planner
```

2. Install dependencies:

```bash
npm install
```

3. Login to Cloudflare:

```bash
npx wrangler login
```

### Running Locally

```bash
npm run dev
```

Visit `http://localhost:8787` to use the app.

## How It Works

1. **User sends a message** → Frontend captures input and user ID
2. **Worker receives request** → Fetches user's conversation history from Durable Object
3. **AI generates response** → Worker calls Llama 3.3 with context and history
4. **Memory updates** → Conversation and preferences saved to Durable Object
5. **Response displayed** → User sees personalized travel advice

## Project Structure

```
cf_ai_travel_planner/
├── src/
│   ├── index.js           # Main Worker (routing, AI calls)
│   └── travel-memory.js   # Durable Object (storage, memory)
├── wrangler.toml          # Cloudflare configuration
├── package.json
└── README.md
```

## Usage Example

**You:** "I want to plan a 5-day trip to Tokyo focused on food"

**AI:** Generates a personalized itinerary based on your interests, asks clarifying questions, and remembers your food preference for future trips.

**You:** "Plan a trip to Paris"

**AI:** References your previous food interest and suggests culinary experiences in Paris.

## Configuration

The `wrangler.toml` file contains:

- AI binding for Workers AI
- Durable Object configuration for memory
- Project metadata

No API keys needed - everything runs on Cloudflare's infrastructure.

## License

MIT
