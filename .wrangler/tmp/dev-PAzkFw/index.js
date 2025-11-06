var __defProp = Object.defineProperty;
var __name = (target, value) => __defProp(target, "name", { value, configurable: true });

// .wrangler/tmp/bundle-8xBtPk/checked-fetch.js
var urls = /* @__PURE__ */ new Set();
function checkURL(request, init) {
  const url = request instanceof URL ? request : new URL(
    (typeof request === "string" ? new Request(request, init) : request).url
  );
  if (url.port && url.port !== "443" && url.protocol === "https:") {
    if (!urls.has(url.toString())) {
      urls.add(url.toString());
      console.warn(
        `WARNING: known issue with \`fetch()\` requests to custom HTTPS ports in published Workers:
 - ${url.toString()} - the custom port will be ignored when the Worker is published using the \`wrangler deploy\` command.
`
      );
    }
  }
}
__name(checkURL, "checkURL");
globalThis.fetch = new Proxy(globalThis.fetch, {
  apply(target, thisArg, argArray) {
    const [request, init] = argArray;
    checkURL(request, init);
    return Reflect.apply(target, thisArg, argArray);
  }
});

// .wrangler/tmp/bundle-8xBtPk/strip-cf-connecting-ip-header.js
function stripCfConnectingIPHeader(input, init) {
  const request = new Request(input, init);
  request.headers.delete("CF-Connecting-IP");
  return request;
}
__name(stripCfConnectingIPHeader, "stripCfConnectingIPHeader");
globalThis.fetch = new Proxy(globalThis.fetch, {
  apply(target, thisArg, argArray) {
    return Reflect.apply(target, thisArg, [
      stripCfConnectingIPHeader.apply(null, argArray)
    ]);
  }
});

// src/travel-memory.js
var TravelMemory = class {
  constructor(state, env) {
    this.state = state;
    this.env = env;
    this.storage = state.storage;
  }
  async fetch(request) {
    const url = new URL(request.url);
    console.log("Durable Object received request:", url.pathname);
    if (url.pathname === "/data") {
      return await this.getData();
    }
    if (url.pathname === "/save") {
      return await this.saveConversation(request);
    }
    if (url.pathname === "/trips") {
      return await this.getTrips();
    }
    console.log("No route matched, returning 404");
    return new Response(JSON.stringify({ error: "Route not found" }), {
      status: 404,
      headers: { "Content-Type": "application/json" }
    });
  }
  async getData() {
    const userData = await this.storage.get("userData") || {
      preferences: {},
      conversationHistory: [],
      savedTrips: []
    };
    return new Response(JSON.stringify(userData), {
      headers: { "Content-Type": "application/json" }
    });
  }
  async handleChat(request) {
    try {
      const { message } = await request.json();
      let userData = await this.storage.get("userData") || {
        preferences: {},
        conversationHistory: [],
        savedTrips: [],
        currentTrip: null
      };
      userData.conversationHistory.push({
        role: "user",
        content: message,
        timestamp: Date.now()
      });
      if (userData.conversationHistory.length > 20) {
        userData.conversationHistory = userData.conversationHistory.slice(-20);
      }
      const aiResponse = await this.generateAIResponse(message, userData);
      userData.conversationHistory.push({
        role: "assistant",
        content: aiResponse,
        timestamp: Date.now()
      });
      await this.extractTripInfo(message, aiResponse, userData);
      await this.storage.put("userData", userData);
      return new Response(
        JSON.stringify({
          response: aiResponse,
          tripsSaved: userData.savedTrips.length
        }),
        {
          headers: { "Content-Type": "application/json" }
        }
      );
    } catch (error) {
      return new Response(
        JSON.stringify({
          error: error.message
        }),
        {
          status: 500,
          headers: { "Content-Type": "application/json" }
        }
      );
    }
  }
  async generateAIResponse(userMessage, userData) {
    const systemPrompt = this.buildSystemPrompt(userData);
    const conversationContext = this.buildConversationContext(
      userData.conversationHistory
    );
    const response = await this.env.AI.run(
      "@cf/meta/llama-3.3-70b-instruct-fp8-fast",
      {
        messages: [
          { role: "system", content: systemPrompt },
          ...conversationContext,
          { role: "user", content: userMessage }
        ],
        max_tokens: 1024,
        temperature: 0.7
      }
    );
    return response.response || "I'm having trouble generating a response. Please try again.";
  }
  buildSystemPrompt(userData) {
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
      prompt += `

User's preferences:
`;
      if (preferences.budget)
        prompt += `- Budget: ${preferences.budget}
`;
      if (preferences.interests)
        prompt += `- Interests: ${preferences.interests.join(", ")}
`;
      if (preferences.pace)
        prompt += `- Travel pace: ${preferences.pace}
`;
    }
    if (savedTrips.length > 0) {
      prompt += `

User's past trips:
`;
      savedTrips.slice(-3).forEach((trip) => {
        prompt += `- ${trip.destination} (${trip.duration})
`;
      });
    }
    return prompt;
  }
  buildConversationContext(history) {
    return history.slice(-10).map((msg) => ({
      role: msg.role,
      content: msg.content
    }));
  }
  async saveConversation(request) {
    try {
      const { userMessage, aiMessage } = await request.json();
      let userData = await this.storage.get("userData") || {
        preferences: {},
        conversationHistory: [],
        savedTrips: []
      };
      userData.conversationHistory.push(
        { role: "user", content: userMessage, timestamp: Date.now() },
        { role: "assistant", content: aiMessage, timestamp: Date.now() }
      );
      if (userData.conversationHistory.length > 20) {
        userData.conversationHistory = userData.conversationHistory.slice(-20);
      }
      await this.extractTripInfo(userMessage, aiMessage, userData);
      await this.storage.put("userData", userData);
      return new Response(JSON.stringify({ success: true }), {
        headers: { "Content-Type": "application/json" }
      });
    } catch (error) {
      console.error("Error in saveConversation:", error);
      return new Response(JSON.stringify({ error: error.message }), {
        status: 500,
        headers: { "Content-Type": "application/json" }
      });
    }
  }
  async extractTripInfo(userMessage, aiResponse, userData) {
    const destinationMatch = userMessage.match(
      /(?:trip to|visit|going to|travel to)\s+([A-Z][a-zA-Z\s]+?)(?:\s|,|\.|\?|$)/i
    );
    const durationMatch = userMessage.match(/(\d+)\s*(?:day|week)/i);
    if (destinationMatch && durationMatch) {
      const destination = destinationMatch[1].trim();
      const duration = `${durationMatch[1]} ${durationMatch[0].includes("week") ? "weeks" : "days"}`;
      const existingTrip = userData.savedTrips.find(
        (t) => t.destination.toLowerCase() === destination.toLowerCase()
      );
      if (!existingTrip) {
        userData.savedTrips.push({
          id: `trip_${Date.now()}`,
          destination,
          duration,
          createdAt: Date.now(),
          itinerary: aiResponse
          // Store the AI's itinerary
        });
        this.updatePreferences(userMessage, userData);
      }
    }
  }
  updatePreferences(message, userData) {
    const lowerMessage = message.toLowerCase();
    if (lowerMessage.includes("budget") || lowerMessage.includes("cheap") || lowerMessage.includes("affordable")) {
      userData.preferences.budget = "budget";
    } else if (lowerMessage.includes("luxury") || lowerMessage.includes("expensive") || lowerMessage.includes("high-end")) {
      userData.preferences.budget = "luxury";
    } else if (lowerMessage.includes("mid-range") || lowerMessage.includes("moderate")) {
      userData.preferences.budget = "mid-range";
    }
    const interests = [];
    if (lowerMessage.includes("food") || lowerMessage.includes("restaurant") || lowerMessage.includes("cuisine")) {
      interests.push("food");
    }
    if (lowerMessage.includes("adventure") || lowerMessage.includes("hiking") || lowerMessage.includes("outdoor")) {
      interests.push("adventure");
    }
    if (lowerMessage.includes("culture") || lowerMessage.includes("museum") || lowerMessage.includes("history")) {
      interests.push("culture");
    }
    if (lowerMessage.includes("beach") || lowerMessage.includes("relax") || lowerMessage.includes("spa")) {
      interests.push("relaxation");
    }
    if (lowerMessage.includes("nightlife") || lowerMessage.includes("party") || lowerMessage.includes("bars")) {
      interests.push("nightlife");
    }
    if (interests.length > 0) {
      userData.preferences.interests = [
        .../* @__PURE__ */ new Set([...userData.preferences.interests || [], ...interests])
      ];
    }
    if (lowerMessage.includes("relaxed") || lowerMessage.includes("slow") || lowerMessage.includes("leisurely")) {
      userData.preferences.pace = "relaxed";
    } else if (lowerMessage.includes("packed") || lowerMessage.includes("busy") || lowerMessage.includes("see everything")) {
      userData.preferences.pace = "packed";
    }
  }
  async getTrips() {
    const userData = await this.storage.get("userData") || {
      savedTrips: []
    };
    return new Response(
      JSON.stringify({
        trips: userData.savedTrips
      }),
      {
        headers: { "Content-Type": "application/json" }
      }
    );
  }
};
__name(TravelMemory, "TravelMemory");

// src/index.js
var src_default = {
  async fetch(request, env) {
    const url = new URL(request.url);
    const corsHeaders = {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type"
    };
    if (request.method === "OPTIONS") {
      return new Response(null, { headers: corsHeaders });
    }
    if (url.pathname === "/" || url.pathname === "/index.html") {
      return new Response(HTML, {
        headers: { "Content-Type": "text/html" }
      });
    }
    if (url.pathname === "/api/chat" && request.method === "POST") {
      try {
        const { message, userId } = await request.json();
        console.log("Received message:", message, "from user:", userId);
        if (!message || !userId) {
          return new Response(
            JSON.stringify({ error: "Missing message or userId" }),
            {
              status: 400,
              headers: { ...corsHeaders, "Content-Type": "application/json" }
            }
          );
        }
        const id = env.TRAVEL_MEMORY.idFromName(userId);
        const stub = env.TRAVEL_MEMORY.get(id);
        const userDataResponse = await stub.fetch(
          new Request("https://fake-host/data")
        );
        const userData = await userDataResponse.json();
        const systemPrompt = buildSystemPrompt(userData);
        const messages = [
          { role: "system", content: systemPrompt },
          ...userData.conversationHistory.slice(-10).map((msg) => ({
            role: msg.role,
            content: msg.content
          })),
          { role: "user", content: message }
        ];
        console.log("Calling AI...");
        const aiResponse = await env.AI.run(
          "@cf/meta/llama-3.3-70b-instruct-fp8-fast",
          {
            messages,
            max_tokens: 1024,
            temperature: 0.7
          }
        );
        const response = aiResponse.response || "Sorry, I couldn't generate a response.";
        await stub.fetch(
          new Request("https://fake-host/save", {
            method: "POST",
            body: JSON.stringify({
              userMessage: message,
              aiMessage: response
            }),
            headers: { "Content-Type": "application/json" }
          })
        );
        return new Response(JSON.stringify({ response }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" }
        });
      } catch (error) {
        console.error("ERROR in /api/chat:", error);
        return new Response(JSON.stringify({ error: error.message }), {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" }
        });
      }
    }
    if (url.pathname === "/api/trips" && request.method === "GET") {
      try {
        const userId = url.searchParams.get("userId");
        if (!userId) {
          return new Response(JSON.stringify({ error: "Missing userId" }), {
            status: 400,
            headers: { ...corsHeaders, "Content-Type": "application/json" }
          });
        }
        const id = env.TRAVEL_MEMORY.idFromName(userId);
        const stub = env.TRAVEL_MEMORY.get(id);
        const response = await stub.fetch(
          new Request("https://fake-host/trips")
        );
        const data = await response.json();
        return new Response(JSON.stringify(data), {
          headers: { ...corsHeaders, "Content-Type": "application/json" }
        });
      } catch (error) {
        return new Response(JSON.stringify({ error: error.message }), {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" }
        });
      }
    }
    return new Response("Not Found", { status: 404 });
  }
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
    prompt += `

User's preferences:
`;
    if (preferences.budget)
      prompt += `- Budget: ${preferences.budget}
`;
    if (preferences.interests)
      prompt += `- Interests: ${preferences.interests.join(", ")}
`;
    if (preferences.pace)
      prompt += `- Travel pace: ${preferences.pace}
`;
  }
  if (savedTrips.length > 0) {
    prompt += `

User's past trips:
`;
    savedTrips.slice(-3).forEach((trip) => {
      prompt += `- ${trip.destination} (${trip.duration})
`;
    });
  }
  return prompt;
}
__name(buildSystemPrompt, "buildSystemPrompt");
var HTML = `<!DOCTYPE html>
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
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
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
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
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
            background: #667eea;
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
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
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
            <h1>\u{1F30D} AI Travel Planner</h1>
            <p>Your personal travel assistant</p>
        </div>
        
        <div class="chat-container" id="chatContainer">
            <div class="message assistant">
                <div class="message-content">
                    \u{1F44B} Hi! I'm your AI travel assistant. Tell me where you'd like to go, and I'll help you plan the perfect trip!
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
    <\/script>
</body>
</html>`;

// node_modules/wrangler/templates/middleware/middleware-ensure-req-body-drained.ts
var drainBody = /* @__PURE__ */ __name(async (request, env, _ctx, middlewareCtx) => {
  try {
    return await middlewareCtx.next(request, env);
  } finally {
    try {
      if (request.body !== null && !request.bodyUsed) {
        const reader = request.body.getReader();
        while (!(await reader.read()).done) {
        }
      }
    } catch (e) {
      console.error("Failed to drain the unused request body.", e);
    }
  }
}, "drainBody");
var middleware_ensure_req_body_drained_default = drainBody;

// node_modules/wrangler/templates/middleware/middleware-miniflare3-json-error.ts
function reduceError(e) {
  return {
    name: e?.name,
    message: e?.message ?? String(e),
    stack: e?.stack,
    cause: e?.cause === void 0 ? void 0 : reduceError(e.cause)
  };
}
__name(reduceError, "reduceError");
var jsonError = /* @__PURE__ */ __name(async (request, env, _ctx, middlewareCtx) => {
  try {
    return await middlewareCtx.next(request, env);
  } catch (e) {
    const error = reduceError(e);
    return Response.json(error, {
      status: 500,
      headers: { "MF-Experimental-Error-Stack": "true" }
    });
  }
}, "jsonError");
var middleware_miniflare3_json_error_default = jsonError;

// .wrangler/tmp/bundle-8xBtPk/middleware-insertion-facade.js
var __INTERNAL_WRANGLER_MIDDLEWARE__ = [
  middleware_ensure_req_body_drained_default,
  middleware_miniflare3_json_error_default
];
var middleware_insertion_facade_default = src_default;

// node_modules/wrangler/templates/middleware/common.ts
var __facade_middleware__ = [];
function __facade_register__(...args) {
  __facade_middleware__.push(...args.flat());
}
__name(__facade_register__, "__facade_register__");
function __facade_invokeChain__(request, env, ctx, dispatch, middlewareChain) {
  const [head, ...tail] = middlewareChain;
  const middlewareCtx = {
    dispatch,
    next(newRequest, newEnv) {
      return __facade_invokeChain__(newRequest, newEnv, ctx, dispatch, tail);
    }
  };
  return head(request, env, ctx, middlewareCtx);
}
__name(__facade_invokeChain__, "__facade_invokeChain__");
function __facade_invoke__(request, env, ctx, dispatch, finalMiddleware) {
  return __facade_invokeChain__(request, env, ctx, dispatch, [
    ...__facade_middleware__,
    finalMiddleware
  ]);
}
__name(__facade_invoke__, "__facade_invoke__");

// .wrangler/tmp/bundle-8xBtPk/middleware-loader.entry.ts
var __Facade_ScheduledController__ = class {
  constructor(scheduledTime, cron, noRetry) {
    this.scheduledTime = scheduledTime;
    this.cron = cron;
    this.#noRetry = noRetry;
  }
  #noRetry;
  noRetry() {
    if (!(this instanceof __Facade_ScheduledController__)) {
      throw new TypeError("Illegal invocation");
    }
    this.#noRetry();
  }
};
__name(__Facade_ScheduledController__, "__Facade_ScheduledController__");
function wrapExportedHandler(worker) {
  if (__INTERNAL_WRANGLER_MIDDLEWARE__ === void 0 || __INTERNAL_WRANGLER_MIDDLEWARE__.length === 0) {
    return worker;
  }
  for (const middleware of __INTERNAL_WRANGLER_MIDDLEWARE__) {
    __facade_register__(middleware);
  }
  const fetchDispatcher = /* @__PURE__ */ __name(function(request, env, ctx) {
    if (worker.fetch === void 0) {
      throw new Error("Handler does not export a fetch() function.");
    }
    return worker.fetch(request, env, ctx);
  }, "fetchDispatcher");
  return {
    ...worker,
    fetch(request, env, ctx) {
      const dispatcher = /* @__PURE__ */ __name(function(type, init) {
        if (type === "scheduled" && worker.scheduled !== void 0) {
          const controller = new __Facade_ScheduledController__(
            Date.now(),
            init.cron ?? "",
            () => {
            }
          );
          return worker.scheduled(controller, env, ctx);
        }
      }, "dispatcher");
      return __facade_invoke__(request, env, ctx, dispatcher, fetchDispatcher);
    }
  };
}
__name(wrapExportedHandler, "wrapExportedHandler");
function wrapWorkerEntrypoint(klass) {
  if (__INTERNAL_WRANGLER_MIDDLEWARE__ === void 0 || __INTERNAL_WRANGLER_MIDDLEWARE__.length === 0) {
    return klass;
  }
  for (const middleware of __INTERNAL_WRANGLER_MIDDLEWARE__) {
    __facade_register__(middleware);
  }
  return class extends klass {
    #fetchDispatcher = (request, env, ctx) => {
      this.env = env;
      this.ctx = ctx;
      if (super.fetch === void 0) {
        throw new Error("Entrypoint class does not define a fetch() function.");
      }
      return super.fetch(request);
    };
    #dispatcher = (type, init) => {
      if (type === "scheduled" && super.scheduled !== void 0) {
        const controller = new __Facade_ScheduledController__(
          Date.now(),
          init.cron ?? "",
          () => {
          }
        );
        return super.scheduled(controller);
      }
    };
    fetch(request) {
      return __facade_invoke__(
        request,
        this.env,
        this.ctx,
        this.#dispatcher,
        this.#fetchDispatcher
      );
    }
  };
}
__name(wrapWorkerEntrypoint, "wrapWorkerEntrypoint");
var WRAPPED_ENTRY;
if (typeof middleware_insertion_facade_default === "object") {
  WRAPPED_ENTRY = wrapExportedHandler(middleware_insertion_facade_default);
} else if (typeof middleware_insertion_facade_default === "function") {
  WRAPPED_ENTRY = wrapWorkerEntrypoint(middleware_insertion_facade_default);
}
var middleware_loader_entry_default = WRAPPED_ENTRY;
export {
  TravelMemory,
  __INTERNAL_WRANGLER_MIDDLEWARE__,
  middleware_loader_entry_default as default
};
//# sourceMappingURL=index.js.map
