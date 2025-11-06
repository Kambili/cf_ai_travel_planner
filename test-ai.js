export default {
  async fetch(request, env) {
    try {
      const response = await env.AI.run(
        "@cf/meta/llama-3.3-70b-instruct-fp8-fast",
        {
          messages: [{ role: "user", content: "Say hello!" }],
        }
      );

      return new Response(JSON.stringify(response), {
        headers: { "Content-Type": "application/json" },
      });
    } catch (error) {
      return new Response(JSON.stringify({ error: error.message }), {
        status: 500,
        headers: { "Content-Type": "application/json" },
      });
    }
  },
};
