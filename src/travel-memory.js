// Durable Object - Stores user's travel data and conversation history

export class TravelMemory {
  constructor(state, env) {
    this.state = state;
    this.env = env;
    this.storage = state.storage;
  }

  async fetch(request) {
    const url = new URL(request.url);

    console.log("Durable Object received request:", url.pathname);

    // Get user data
    if (url.pathname === "/data") {
      return await this.getData();
    }

    // Save conversation
    if (url.pathname === "/save") {
      return await this.saveConversation(request);
    }

    // Get saved trips
    if (url.pathname === "/trips") {
      return await this.getTrips();
    }

    console.log("No route matched, returning 404");
    return new Response(JSON.stringify({ error: "Route not found" }), {
      status: 404,
      headers: { "Content-Type": "application/json" },
    });
  }

  async getData() {
    const userData = (await this.storage.get("userData")) || {
      preferences: {},
      conversationHistory: [],
      savedTrips: [],
    };

    return new Response(JSON.stringify(userData), {
      headers: { "Content-Type": "application/json" },
    });
  }

  async handleChat(request) {
    try {
      const { message } = await request.json();

      // Load user data
      let userData = (await this.storage.get("userData")) || {
        preferences: {},
        conversationHistory: [],
        savedTrips: [],
        currentTrip: null,
      };

      // Add user message to history
      userData.conversationHistory.push({
        role: "user",
        content: message,
        timestamp: Date.now(),
      });

      // Keep only last 20 messages to avoid token limits
      if (userData.conversationHistory.length > 20) {
        userData.conversationHistory = userData.conversationHistory.slice(-20);
      }

      // Generate AI response
      const aiResponse = await this.generateAIResponse(message, userData);

      // Add AI response to history
      userData.conversationHistory.push({
        role: "assistant",
        content: aiResponse,
        timestamp: Date.now(),
      });

      // Extract and save any trip information from the conversation
      await this.extractTripInfo(message, aiResponse, userData);

      // Save updated user data
      await this.storage.put("userData", userData);

      return new Response(
        JSON.stringify({
          response: aiResponse,
          tripsSaved: userData.savedTrips.length,
        }),
        {
          headers: { "Content-Type": "application/json" },
        }
      );
    } catch (error) {
      return new Response(
        JSON.stringify({
          error: error.message,
        }),
        {
          status: 500,
          headers: { "Content-Type": "application/json" },
        }
      );
    }
  }

  async generateAIResponse(userMessage, userData) {
    // Build context-aware prompt
    const systemPrompt = this.buildSystemPrompt(userData);
    const conversationContext = this.buildConversationContext(
      userData.conversationHistory
    );

    // Call Llama 3.3 via Workers AI
    const response = await this.env.AI.run(
      "@cf/meta/llama-3.3-70b-instruct-fp8-fast",
      {
        messages: [
          { role: "system", content: systemPrompt },
          ...conversationContext,
          { role: "user", content: userMessage },
        ],
        max_tokens: 1024,
        temperature: 0.7,
      }
    );

    return (
      response.response ||
      "I'm having trouble generating a response. Please try again."
    );
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

    // Add user preferences if available
    if (Object.keys(preferences).length > 0) {
      prompt += `\n\nUser's preferences:\n`;
      if (preferences.budget) prompt += `- Budget: ${preferences.budget}\n`;
      if (preferences.interests)
        prompt += `- Interests: ${preferences.interests.join(", ")}\n`;
      if (preferences.pace) prompt += `- Travel pace: ${preferences.pace}\n`;
    }

    // Add past trips context
    if (savedTrips.length > 0) {
      prompt += `\n\nUser's past trips:\n`;
      savedTrips.slice(-3).forEach((trip) => {
        prompt += `- ${trip.destination} (${trip.duration})\n`;
      });
    }

    return prompt;
  }

  buildConversationContext(history) {
    // Get last 10 messages for context
    return history.slice(-10).map((msg) => ({
      role: msg.role,
      content: msg.content,
    }));
  }

  async saveConversation(request) {
    try {
      const { userMessage, aiMessage } = await request.json();

      let userData = (await this.storage.get("userData")) || {
        preferences: {},
        conversationHistory: [],
        savedTrips: [],
      };

      // Add messages to history
      userData.conversationHistory.push(
        { role: "user", content: userMessage, timestamp: Date.now() },
        { role: "assistant", content: aiMessage, timestamp: Date.now() }
      );

      // Keep last 20 messages
      if (userData.conversationHistory.length > 20) {
        userData.conversationHistory = userData.conversationHistory.slice(-20);
      }

      // Extract trip info
      await this.extractTripInfo(userMessage, aiMessage, userData);

      // Save
      await this.storage.put("userData", userData);

      return new Response(JSON.stringify({ success: true }), {
        headers: { "Content-Type": "application/json" },
      });
    } catch (error) {
      console.error("Error in saveConversation:", error);
      return new Response(JSON.stringify({ error: error.message }), {
        status: 500,
        headers: { "Content-Type": "application/json" },
      });
    }
  }
  async extractTripInfo(userMessage, aiResponse, userData) {
    // Simple pattern matching to detect trip planning
    const destinationMatch = userMessage.match(
      /(?:trip to|visit|going to|travel to)\s+([A-Z][a-zA-Z\s]+?)(?:\s|,|\.|\?|$)/i
    );
    const durationMatch = userMessage.match(/(\d+)\s*(?:day|week)/i);

    if (destinationMatch && durationMatch) {
      // Check if this trip already exists
      const destination = destinationMatch[1].trim();
      const duration = `${durationMatch[1]} ${
        durationMatch[0].includes("week") ? "weeks" : "days"
      }`;

      const existingTrip = userData.savedTrips.find(
        (t) => t.destination.toLowerCase() === destination.toLowerCase()
      );

      if (!existingTrip) {
        // Save new trip
        userData.savedTrips.push({
          id: `trip_${Date.now()}`,
          destination,
          duration,
          createdAt: Date.now(),
          itinerary: aiResponse, // Store the AI's itinerary
        });

        // Update preferences based on the conversation
        this.updatePreferences(userMessage, userData);
      }
    }
  }

  updatePreferences(message, userData) {
    const lowerMessage = message.toLowerCase();

    // Extract budget preference
    if (
      lowerMessage.includes("budget") ||
      lowerMessage.includes("cheap") ||
      lowerMessage.includes("affordable")
    ) {
      userData.preferences.budget = "budget";
    } else if (
      lowerMessage.includes("luxury") ||
      lowerMessage.includes("expensive") ||
      lowerMessage.includes("high-end")
    ) {
      userData.preferences.budget = "luxury";
    } else if (
      lowerMessage.includes("mid-range") ||
      lowerMessage.includes("moderate")
    ) {
      userData.preferences.budget = "mid-range";
    }

    // Extract interests
    const interests = [];
    if (
      lowerMessage.includes("food") ||
      lowerMessage.includes("restaurant") ||
      lowerMessage.includes("cuisine")
    ) {
      interests.push("food");
    }
    if (
      lowerMessage.includes("adventure") ||
      lowerMessage.includes("hiking") ||
      lowerMessage.includes("outdoor")
    ) {
      interests.push("adventure");
    }
    if (
      lowerMessage.includes("culture") ||
      lowerMessage.includes("museum") ||
      lowerMessage.includes("history")
    ) {
      interests.push("culture");
    }
    if (
      lowerMessage.includes("beach") ||
      lowerMessage.includes("relax") ||
      lowerMessage.includes("spa")
    ) {
      interests.push("relaxation");
    }
    if (
      lowerMessage.includes("nightlife") ||
      lowerMessage.includes("party") ||
      lowerMessage.includes("bars")
    ) {
      interests.push("nightlife");
    }

    if (interests.length > 0) {
      userData.preferences.interests = [
        ...new Set([...(userData.preferences.interests || []), ...interests]),
      ];
    }

    // Extract pace preference
    if (
      lowerMessage.includes("relaxed") ||
      lowerMessage.includes("slow") ||
      lowerMessage.includes("leisurely")
    ) {
      userData.preferences.pace = "relaxed";
    } else if (
      lowerMessage.includes("packed") ||
      lowerMessage.includes("busy") ||
      lowerMessage.includes("see everything")
    ) {
      userData.preferences.pace = "packed";
    }
  }

  async getTrips() {
    const userData = (await this.storage.get("userData")) || {
      savedTrips: [],
    };

    return new Response(
      JSON.stringify({
        trips: userData.savedTrips,
      }),
      {
        headers: { "Content-Type": "application/json" },
      }
    );
  }
}
