import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import { disposalLocations, disposalTypes } from "./data";

import { GoogleGenerativeAI } from "@google/generative-ai";

const app = new Hono();

app.get("/submit", async (c) => {
  return streamSSE(c, async (stream) => {
    const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY as string);
    const model = genAI.getGenerativeModel({
      model: "gemini-1.5-flash",
      systemInstruction: "",
    });

    const prompt = "Explain how AI works";

    const result = await model.generateContentStream(prompt);
    let i = 0;
    for await (const chunk of result.stream) {
      const chunkText = chunk.text();
      console.log(chunkText);
      await stream.writeSSE({
        data: chunkText,
        event: "gemini-response",
        id: i.toString(),
      });
      i++;
    }
  });
});

app.get("/health", (c) => {
  return c.json({ status: "healthy" });
});

export default app;
