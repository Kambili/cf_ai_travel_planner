// Main Worker - handles routing and coordination

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    // CORS headers for frontend
    const corsHeaders = {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    };

    // Handle preflight
    if (request.method === "OPTIONS") {
      return new Response(null, { headers: corsHeaders });
    }

    // Serve frontend
    if (url.pathname === "/" || url.pathname === "/index.html") {
      return new Response(HTML, {
        headers: { "Content-Type": "text/html" },
      });
    }

    // API endpoint for chat
    // API endpoint for chat
    if (url.pathname === "/api/chat" && request.method === "POST") {
      try {
        const { message, userId } = await request.json();

        console.log("Received message:", message, "from user:", userId);

        if (!message || !userId) {
          return new Response(
            JSON.stringify({ error: "Missing message or userId" }),
            {
              status: 400,
              headers: { ...corsHeaders, "Content-Type": "application/json" },
            }
          );
        }

        // Get user's Durable Object
        const id = env.TRAVEL_MEMORY.idFromName(userId);
        const stub = env.TRAVEL_MEMORY.get(id);

        // Get user data and history from Durable Object
        const userDataResponse = await stub.fetch(
          new Request("https://fake-host/data")
        );
        const userData = await userDataResponse.json();

        // Build AI prompt with context
        const systemPrompt = buildSystemPrompt(userData);
        const messages = [
          { role: "system", content: systemPrompt },
          ...userData.conversationHistory.slice(-10).map((msg) => ({
            role: msg.role,
            content: msg.content,
          })),
          { role: "user", content: message },
        ];

        // Call AI here in the Worker
        console.log("Calling AI...");
        const aiResponse = await env.AI.run(
          "@cf/meta/llama-3.3-70b-instruct-fp8-fast",
          {
            messages,
            max_tokens: 1024,
            temperature: 0.7,
          }
        );

        const response =
          aiResponse.response || "Sorry, I couldn't generate a response.";

        // Save conversation to Durable Object
        await stub.fetch(
          new Request("https://fake-host/save", {
            method: "POST",
            body: JSON.stringify({
              userMessage: message,
              aiMessage: response,
            }),
            headers: { "Content-Type": "application/json" },
          })
        );

        return new Response(JSON.stringify({ response }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      } catch (error) {
        console.error("ERROR in /api/chat:", error);
        return new Response(JSON.stringify({ error: error.message }), {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
    }

    // Get user's saved trips
    if (url.pathname === "/api/trips" && request.method === "GET") {
      try {
        const userId = url.searchParams.get("userId");

        if (!userId) {
          return new Response(JSON.stringify({ error: "Missing userId" }), {
            status: 400,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }

        const id = env.TRAVEL_MEMORY.idFromName(userId);
        const stub = env.TRAVEL_MEMORY.get(id);

        const response = await stub.fetch(
          new Request("https://fake-host/trips")
        );
        const data = await response.json();

        return new Response(JSON.stringify(data), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      } catch (error) {
        return new Response(JSON.stringify({ error: error.message }), {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
    }

    return new Response("Not Found", { status: 404 });
  },
};

function buildSystemPrompt(userData) {
  const { preferences, savedTrips } = userData;

  let prompt = `You are a friendly, knowledgeable travel planning assistant. Your goal is to help users plan amazing trips.

Your approach:
1. Ask clarifying questions to understand their needs (destination, duration, budget, interests)
2. Generate detailed, day-by-day itineraries
3. Remember their preferences and reference past trips
4. Be enthusiastic and helpful
5. Keep responses concise but informative

Guidelines:
- Always format itineraries clearly with day numbers
- Include specific recommendations (restaurants, activities, neighborhoods)
- Consider practical details (travel time, opening hours, budget)
- Adapt to their travel style (relaxed vs. packed schedule)
`;

  if (Object.keys(preferences).length > 0) {
    prompt += `\n\nUser's preferences:\n`;
    if (preferences.budget) prompt += `- Budget: ${preferences.budget}\n`;
    if (preferences.interests)
      prompt += `- Interests: ${preferences.interests.join(", ")}\n`;
    if (preferences.pace) prompt += `- Travel pace: ${preferences.pace}\n`;
  }

  if (savedTrips.length > 0) {
    prompt += `\n\nUser's past trips:\n`;
    savedTrips.slice(-3).forEach((trip) => {
      prompt += `- ${trip.destination} (${trip.duration})\n`;
    });
  }

  return prompt;
}

// Import Durable Object
export { TravelMemory } from "./travel-memory.js";

// Inline HTML (we'll move this to a separate file later)
const HTML = `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>AI Travel Planner</title>
    <style>
        * {
            margin: 0;
            padding: 0;
            box-sizing: border-box;
        }
        
        body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, sans-serif;
            background: #f0f0f0;  /* Light gray */
            height: 100vh;
            display: flex;
            justify-content: center;
            align-items: center;
            padding: 20px;
        }
        
        .container {
            background: white;
            border-radius: 20px;
            box-shadow: 0 20px 60px rgba(0,0,0,0.3);
            width: 100%;
            max-width: 800px;
            height: 600px;
            display: flex;
            flex-direction: column;
            overflow: hidden;
        }
        
        .header {
            background: linear-gradient(135deg, #2c3e50 0%, #34495e 100%);
            color: white;
            padding: 20px;
            text-align: center;
        }
        
        .header h1 {
            font-size: 24px;
            margin-bottom: 5px;
        }
        
        .header p {
            opacity: 0.9;
            font-size: 14px;
        }
        
        .chat-container {
            flex: 1;
            overflow-y: auto;
            padding: 20px;
            background: #f7f7f7;
        }
        
        .message {
            margin-bottom: 15px;
            display: flex;
            animation: fadeIn 0.3s;
        }
        
        @keyframes fadeIn {
            from { opacity: 0; transform: translateY(10px); }
            to { opacity: 1; transform: translateY(0); }
        }
        
        .message.user {
            justify-content: flex-end;
        }
        
        .message-content {
            max-width: 70%;
            padding: 12px 16px;
            border-radius: 18px;
            word-wrap: break-word;
        }
        
        .message.user .message-content {
            background: linear-gradient(135deg, #2c3e50 0%, #34495e 100%);
            color: white;
            border-bottom-right-radius: 4px;
        }
        
        .message.assistant .message-content {
            background: white;
            color: #333;
            border-bottom-left-radius: 4px;
            box-shadow: 0 2px 5px rgba(0,0,0,0.1);
        }
        
        .input-container {
            padding: 20px;
            background: white;
            border-top: 1px solid #e0e0e0;
            display: flex;
            gap: 10px;
        }
        
        #messageInput {
            flex: 1;
            padding: 12px 16px;
            border: 2px solid #e0e0e0;
            border-radius: 25px;
            font-size: 14px;
            outline: none;
            transition: border-color 0.3s;
        }
        
        #messageInput:focus {
            border-color: #667eea;
        }
        
        #sendButton {
            padding: 12px 24px;
            background: linear-gradient(135deg, #2c3e50 0%, #34495e 100%);
            color: white;
            border: none;
            border-radius: 25px;
            cursor: pointer;
            font-size: 14px;
            font-weight: 600;
            transition: transform 0.2s, box-shadow 0.2s;
        }
        
        #sendButton:hover {
            transform: translateY(-2px);
            box-shadow: 0 5px 15px rgba(102, 126, 234, 0.4);
        }
        
        #sendButton:disabled {
            opacity: 0.5;
            cursor: not-allowed;
            transform: none;
        }
        
        .loading {
            display: flex;
            gap: 5px;
            padding: 12px 16px;
        }
        
        .loading span {
            width: 8px;
            height: 8px;
            background: #667eea;
            border-radius: 50%;
            animation: bounce 1.4s infinite ease-in-out both;
        }
        
        .loading span:nth-child(1) { animation-delay: -0.32s; }
        .loading span:nth-child(2) { animation-delay: -0.16s; }
        
        @keyframes bounce {
            0%, 80%, 100% { transform: scale(0); }
            40% { transform: scale(1); }
        }
        
        .trips-sidebar {
            position: fixed;
            right: -300px;
            top: 0;
            width: 300px;
            height: 100vh;
            background: white;
            box-shadow: -2px 0 10px rgba(0,0,0,0.1);
            transition: right 0.3s;
            padding: 20px;
            overflow-y: auto;
        }
        
        .trips-sidebar.open {
            right: 0;
        }
    </style>
</head>
<body>
    <div class="container">
        <div class="header">
            <h1>🌍 AI Travel Planner</h1>
            <p>Your personal travel assistant</p>
        </div>
        
        <div class="chat-container" id="chatContainer">
            <div class="message assistant">
                <div class="message-content">
                    👋 Hi! I'm your AI travel assistant. Tell me where you'd like to go, and I'll help you plan the perfect trip!
                </div>
            </div>
        </div>
        
        <div class="input-container">
            <input 
                type="text" 
                id="messageInput" 
                placeholder="E.g., I want to plan a 5-day trip to Tokyo..."
                autocomplete="off"
            >
            <button id="sendButton">Send</button>
        </div>
    </div>

    <script>
        // Generate or retrieve user ID
        let userId = localStorage.getItem('userId');
        if (!userId) {
            userId = 'user_' + Math.random().toString(36).substr(2, 9);
            localStorage.setItem('userId', userId);
        }

        const chatContainer = document.getElementById('chatContainer');
        const messageInput = document.getElementById('messageInput');
        const sendButton = document.getElementById('sendButton');

        function addMessage(content, isUser = false) {
            const messageDiv = document.createElement('div');
            messageDiv.className = \`message \${isUser ? 'user' : 'assistant'}\`;
            
            const contentDiv = document.createElement('div');
            contentDiv.className = 'message-content';
            contentDiv.textContent = content;
            
            messageDiv.appendChild(contentDiv);
            chatContainer.appendChild(messageDiv);
            chatContainer.scrollTop = chatContainer.scrollHeight;
        }

        function showLoading() {
            const loadingDiv = document.createElement('div');
            loadingDiv.className = 'message assistant';
            loadingDiv.id = 'loading';
            
            const contentDiv = document.createElement('div');
            contentDiv.className = 'message-content loading';
            contentDiv.innerHTML = '<span></span><span></span><span></span>';
            
            loadingDiv.appendChild(contentDiv);
            chatContainer.appendChild(loadingDiv);
            chatContainer.scrollTop = chatContainer.scrollHeight;
        }

        function hideLoading() {
            const loading = document.getElementById('loading');
            if (loading) loading.remove();
        }

        async function sendMessage() {
            const message = messageInput.value.trim();
            if (!message) return;

            // Add user message
            addMessage(message, true);
            messageInput.value = '';
            sendButton.disabled = true;
            showLoading();

            try {
                const response = await fetch('/api/chat', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ message, userId })
                });

                const data = await response.json();
                hideLoading();

                if (data.error) {
                    addMessage('Sorry, something went wrong. Please try again.');
                } else {
                    addMessage(data.response);
                }
            } catch (error) {
                hideLoading();
                addMessage('Sorry, I couldn\\'t connect. Please try again.');
            }

            sendButton.disabled = false;
            messageInput.focus();
        }

        sendButton.addEventListener('click', sendMessage);
        messageInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') sendMessage();
        });

        // Focus input on load
        messageInput.focus();
    </script>
</body>
</html>`;
