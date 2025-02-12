import { Hono } from "hono";
import { cors } from "hono/cors";

import { streamSSE } from "hono/streaming";
import { disposalLocations, disposalTypes } from "./data";

import { GoogleGenerativeAI } from "@google/generative-ai";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";

const app = new Hono();
app.use("/*", cors());

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
			"Only .png, .jpg, & .jpeg formats are supported.",
		),
	location: z.string().min(1, "Location is required"),
});

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

		try {
			const formData = new FormData();
			formData.append("file", file);

			const res = await fetch(`${process.env.ML_INFERENCE_API_URL}/predict/`, {
				method: "POST",
				body: formData,
			});

			if (!res.ok) {
				throw new Error(res.statusText);
			}

			const classifiedImage: InferenceResponse = await res.json();
			const type = classifiedImage.class_name;

			return c.json({
				location: submittedLocation,
				imageClass: type,
			});
		} catch (error: unknown) {
			if (error instanceof Error) {
				console.error("Error classifying image:", error.message);
				return c.json(
					{ error: `Failed to classify the image: ${error.message}` },
					500,
				);
			}
			console.error("Unknown error classifying image:", error);
			return c.json({ error: "Failed to classify the image" }, 500);
		}
	},
);

app.get("/stream", async (c) => {
	const location = c.req.query("location");
	const langauge = c.req.query("language");
	const imageClass = c.req.query("imageClass");

	if (!location || !imageClass) {
		return c.json(
			{
				error: "Missing query parameters: location and imageClass are required",
			},
			400,
		);
	}

	const foundLocations = disposalLocations.filter(
		(loc) => loc.city === location,
	);
	const addressesAndContact: string = foundLocations
		.map((loc) => `${loc.address}, ${loc.contact}`)
		.join(", ");

	return streamSSE(
		c,
		async (stream) => {
			const genAI = new GoogleGenerativeAI(
				process.env.GEMINI_API_KEY as string,
			);
			const model = genAI.getGenerativeModel({
				model: "gemini-1.5-flash",
				systemInstruction: `You are an AI assistant specializing in electronic waste disposal guidance in India specifically. Your role is to provide clear, accurate, and location-specific instructions on how to properly dispose of various types of e-waste.
        •	When responding, always start with: Here’s how you can dispose of a ${imageClass}:
        •	Explain where users can dispose of a ${imageClass} by referencing ${addressesAndContact} and describing the appropriate disposal method from ${disposalTypes[imageClass]}. Separate key information using <br> for better readability.
        •	Provide helpful background information on the ${imageClass}, including:
          •	Environmental impact: Explain how improper disposal affects the environment.
          •	Recycling benefits: Highlight why recycling this item is important.
          •	Legal considerations: Mention relevant e-waste regulations in India.
        •	Format responses using HTML tags such as <strong>, <pre>, and <br> instead of standard markdown formatting.
          •	Whenever you do decide to use <br> make sure you use it twice at once.
        •	Respond using ${langauge}.
        •	Always be polite, concise, and informative, ensuring the user clearly understands their disposal options.`,
			});

			const prompt = `Hi, I'm located at ${location} and I have a ${imageClass} that I need to dispose of. Can you help me with the process?`;

			const result = await model.generateContentStream(prompt);
			let i = 0;
			for await (const chunk of result.stream) {
				const chunkText = chunk.text();
				// console.log(`sending message chunk ${i}-${location}-${imageClass}`);
				process.stdout.write(chunkText);
				await stream.writeSSE({
					data: chunkText,
					event: "message",
					id: i.toString(),
				});
				i++;
			}
			await stream.writeSSE({
				data: "[DONE]",
				event: "message",
			});
			await stream.close();
		},
		async (e, stream) => {
			console.error("Error:", e.message);
			await stream.writeSSE({
				data: "An error occurred during streaming with Gemini!",
				event: "error",
			});
			await stream.close();
		},
	);
});

app.get("/health", (c) => {
	return c.json({ status: "healthy" });
});

export default app;
