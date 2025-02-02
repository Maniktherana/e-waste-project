import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import { disposalLocations, disposalTypes } from "./data";

import { GoogleGenerativeAI } from "@google/generative-ai";

const app = new Hono();

app.get("/submit", async (c) => {
  // const body = await c.req.formData();

  const type = "Mobile";
  const submittedLocation = "Noida";
  const foundLocations = disposalLocations.filter(
    (location) => location.city === submittedLocation
  );
  const addressesAndContact: string = foundLocations
    .map((location) => `${location.address}, ${location.contact}`)
    .join(", ");

  return streamSSE(
    c,
    async (stream) => {
      const genAI = new GoogleGenerativeAI(
        process.env.GEMINI_API_KEY as string
      );
      const model = genAI.getGenerativeModel({
        model: "gemini-1.5-flash",
        systemInstruction: `You are an AI assistant specializing in electronic waste disposal guidance in India specifically. Your role is to provide clear, accurate, and location-specific instructions on how to properly dispose of various types of e-waste.
        •	When responding, always start with: “Here’s how you can dispose of a ${type}:”
        •	Explain where users can dispose of a ${type} by referencing ${addressesAndContact} and describing the appropriate disposal method from ${disposalTypes[type]}.
        •	Provide helpful background information on the ${type}, including environmental impact, recycling benefits, and any legal considerations.
        •	Always be polite, concise, and informative, ensuring the user understands their options clearly.`,
      });

      const prompt = `Hi, I'm located at ${submittedLocation} and I have a ${type} that I need to dispose of. Can you help me with the process?`;

      const result = await model.generateContentStream(prompt);
      let i = 0;
      for await (const chunk of result.stream) {
        const chunkText = chunk.text();
        console.log(`sending message chunk ${i}`);
        // console.log(chunkText);
        await stream.writeSSE({
          data: chunkText,
          event: "message",
          id: i.toString(),
        });
        i++;
      }
      await stream.close();
    },
    async (e, stream) => {
      console.error("Error:", e.message);
      await stream.writeSSE({
        data: "An error occured during streaming with Gemini!",
        event: "error",
      });
      await stream.close();
    }
  );
});

app.get("/health", (c) => {
  return c.json({ status: "healthy" });
});

export default app;
