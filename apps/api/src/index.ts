import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import { disposalLocations, disposalTypes } from "./data";

import { GoogleGenerativeAI } from "@google/generative-ai";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";

const app = new Hono();

type InferenceResponse = {
  class_id: number;
  class_name: string;
  confidence: number;
};

// Max size is 5MB.
const MAX_FILE_SIZE = 5000000;

function checkFileType(file: File) {
  if (file?.name) {
    const fileType = file.name.split(".").pop()?.toLowerCase();
    if (fileType === "png" || fileType === "jpg" || fileType === "jpeg") {
      return true;
    }
  }
  return false;
}

const submitSchema = z.object({
  file: z
    .custom<File>((val) => val instanceof File, "Invalid file")
    .refine((file) => file.size < MAX_FILE_SIZE, "Max size is 5MB.")
    .refine(
      (file) => checkFileType(file),
      "Only .png, .jpg, & .jpeg formats are supported."
    ),
  location: z.string().min(1, "Location is required"),
});

const getImageType = async (
  file: File,
  url: string
): Promise<InferenceResponse> => {
  const formData = new FormData();
  formData.append("file", file);

  const res = await fetch(url, {
    method: "POST",
    body: formData,
  });

  if (!res.ok) {
    throw new Error(res.statusText);
  }

  const classifiedImage: InferenceResponse = await res.json();
  return classifiedImage;
};

app.post(
  "/submit",
  zValidator("form", submitSchema, (result, c) => {
    if (!result.success) {
      return c.json(result.error, 422);
    }
  }),
  async (c) => {
    const body = await c.req.formData();
    const file = body.get("file") as File;
    const submittedLocation = body.get("location") as string;

    const foundLocations = disposalLocations.filter(
      (location) => location.city === submittedLocation
    );
    const addressesAndContact: string = foundLocations
      .map((location) => `${location.address}, ${location.contact}`)
      .join(", ");

    let classifiedImage: InferenceResponse;
    try {
      classifiedImage = await getImageType(
        file,
        `${process.env.ML_INFERENCE_API_URL}/predict/`
      );
    } catch (error: unknown) {
      if (error instanceof Error) {
        console.error("Error classifying image:", error.message);
        return c.json(
          { error: `Failed to classify the image: ${error.message}` },
          500
        );
      }
      console.error("Unknown error classifying image:", error);
      return c.json({ error: "Failed to classify the image" }, 500);
    }

    const type = classifiedImage.class_name;

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
  }
);

app.get("/health", (c) => {
  return c.json({ status: "healthy" });
});

export default app;
