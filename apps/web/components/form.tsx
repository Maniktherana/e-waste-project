"use client";

import { Button } from "@repo/ui/components/button";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@repo/ui/components/card";
import { Label } from "@repo/ui/components/label";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@repo/ui/components/select";
import { cn } from "@repo/ui/lib/utils";
import { Loader2, Upload } from "lucide-react";
import Image from "next/image";
import { useState } from "react";
import { toast } from "sonner";
import StreamingResponse from "./streaming-response";

// Define location data
const locations = [
	{ id: "1", city: "Greater Noida", state: "UTTAR_PRADESH" },
	{ id: "2", city: "Ghaziabad", state: "UTTAR_PRADESH" },
	{ id: "3", city: "Noida", state: "UTTAR_PRADESH" },
	{ id: "4", city: "Ahmedabad", state: "GUJARAT" },
	{ id: "4", city: "Bhopal", state: "MADHYA_PRADESH" },
	{ id: "4", city: "Bhubaneswar", state: "ODISHA" },
	{ id: "4", city: "Kamrup", state: "ASSAM" },
	{ id: "4", city: "Secundrabad", state: "ANDHRA_PRADESH" },
	{ id: "4", city: "Nelmangala", state: "KARNATAKA" },
	{ id: "4", city: "Ranchi", state: "JHARKHAND" },
	{ id: "4", city: "Patna", state: "BIHAR" },
	{ id: "4", city: "Pargana", state: "WEST_BENGAL" },
	{ id: "4", city: "Ludhiana", state: "PUNJAB" },
	{ id: "4", city: "Jammu", state: "JAMMU_&_KASHMIR" },
	{ id: "4", city: "Thane", state: "MAHARASHTRA" },
	{ id: "4", city: "Jaipur", state: "RAJASTHAN" },
	{ id: "4", city: "Bhalukpong", state: "ARUNACHAL_PRADESH" },
	{ id: "4", city: "Hyderabad", state: "TELANGANA" },
	{ id: "4", city: "Bangalore", state: "TAMILNADU" },
	{ id: "4", city: "Cochin", state: "TAMILNADU" },
	{ id: "4", city: "Dimapur", state: "NAGALAND" },
	// ... other locations
];

const language = [
	{ id: "1", language: "English", display: "English" },
	{ id: "2", language: "Hindi", display: "हिन्दी" },
	{ id: "3", language: "Tamil", display: "தமிழ்" },
	{ id: "4", language: "Telugu", display: "తెలుగు" },
];

// Get unique cities
const uniqueCities = Array.from(
	new Set(locations.map((loc) => loc.city)),
).sort();

export default function ImageLocationForm() {
	const [selectedImage, setSelectedImage] = useState<File | null>(null);
	const [previewUrl, setPreviewUrl] = useState<string | null>(null);
	const [selectedCity, setSelectedCity] = useState<string>("");
	const [selectedLang, setSelectedLang] = useState<string>("English");
	const [imageClass, setImageClass] = useState<string>("");
	const [isLoading, setIsLoading] = useState(false);
	const [isDragging, setIsDragging] = useState(false);
	const [showResponse, setShowResponse] = useState(false);

	const handleImageChange = (e: React.ChangeEvent<HTMLInputElement>) => {
		const file = e.target.files?.[0];
		if (file) {
			if (!file.type.match(/image\/(jpeg|jpg|png)/)) {
				toast.error("Please select a valid image file (jpg, jpeg, or png)");
				return;
			}
			setSelectedImage(file);
			const reader = new FileReader();
			reader.onload = (e) => {
				setPreviewUrl(e.target?.result as string);
			};
			reader.readAsDataURL(file);
		}
	};

	const handleDragOver = (e: React.DragEvent) => {
		e.preventDefault();
		setIsDragging(true);
	};

	const handleDragLeave = (e: React.DragEvent) => {
		e.preventDefault();
		setIsDragging(false);
	};

	const handleDrop = (e: React.DragEvent) => {
		e.preventDefault();
		setIsDragging(false);
		const file = e.dataTransfer.files[0];
		if (file && file.type.match(/image\/(jpeg|jpg|png)/)) {
			setSelectedImage(file);
			const reader = new FileReader();
			reader.onload = (e) => {
				setPreviewUrl(e.target?.result as string);
			};
			reader.readAsDataURL(file);
		} else {
			toast.error("Please drop a valid image file (jpg, jpeg, or png)");
		}
	};

	const handleSubmit = async (e: React.FormEvent) => {
		e.preventDefault();
		if (!selectedImage || !selectedCity) {
			toast.error("Please select both an image and a city");
			return;
		}

		setIsLoading(true);
		try {
			const formData = new FormData();
			formData.append("location", selectedCity);
			formData.append("language", selectedLang);
			formData.append("file", selectedImage as File);

			const response = await fetch("http://localhost:5002/submit", {
				method: "POST",
				body: formData,
			});

			if (!response.ok) {
				throw new Error(response.statusText);
			}

			const data = await response.json();

			setImageClass(data.imageClass);
			setShowResponse(true);
		} catch (error: unknown) {
			if (error instanceof Error) {
				console.error("Error submitting form:", error.message);
				toast.error(`Failed to submit form: ${error.message}`);
			} else {
				console.error("Unknown error submitting form:", error);
				toast.error("An unknown error occurred while submitting the form.");
			}
		} finally {
			setIsLoading(false);
		}
	};

	return (
		<>
			<Card className="w-full max-w-xl mx-auto">
				<CardHeader>
					<CardTitle className="text-2xl font-bold">E-waste Analyzer</CardTitle>
					<CardDescription className="text-sm text-muted-foreground">
						Submit an image to analyze the type of e-waste. Figure out the type
						of e-waste you have and how to dispose of it properly.
					</CardDescription>
				</CardHeader>
				<CardContent>
					<form onSubmit={handleSubmit} className="space-y-6">
						{/* Image Upload Section */}
						<div className="space-y-2">
							<Label htmlFor="image">Image Upload</Label>
							<div
								className={cn(
									"border-2 border-dashed rounded-lg p-6 text-center cursor-pointer transition-colors",
									isDragging
										? "border-primary bg-primary/5"
										: "border-muted-foreground/25 hover:border-primary/50",
									selectedImage && "border-primary/50 bg-primary/5",
								)}
								onDragOver={handleDragOver}
								onDragLeave={handleDragLeave}
								onDrop={handleDrop}
								onClick={() => document.getElementById("image")?.click()}
							>
								<input
									id="image"
									type="file"
									accept="image/jpeg,image/png,image/jpg"
									onChange={handleImageChange}
									className="hidden"
								/>
								{previewUrl ? (
									<div className="relative w-full aspect-video">
										<Image
											src={previewUrl}
											alt="Preview"
											fill
											className="object-contain rounded-lg"
										/>
									</div>
								) : (
									<div className="flex flex-col items-center gap-2">
										<Upload className="w-8 h-8 text-muted-foreground" />
										<p className="text-sm text-muted-foreground">
											Drag and drop an image, or click to select
										</p>
										<p className="text-xs text-muted-foreground">
											Supports: JPG, JPEG, PNG
										</p>
									</div>
								)}
							</div>
						</div>

						{/* Location Selection */}
						<div className="space-y-2">
							<Label htmlFor="location">Location</Label>
							<Select value={selectedCity} onValueChange={setSelectedCity}>
								<SelectTrigger id="location">
									<SelectValue placeholder="Select a city" />
								</SelectTrigger>
								<SelectContent>
									{uniqueCities.map((city) => (
										<SelectItem key={city} value={city}>
											{city}
										</SelectItem>
									))}
								</SelectContent>
							</Select>
						</div>

						{/* Langauge Selection */}
						<div className="space-y-2">
							<Label htmlFor="location">Language</Label>
							<Select value={selectedLang} onValueChange={setSelectedLang}>
								<SelectTrigger id="language">
									<SelectValue placeholder="English" />
								</SelectTrigger>
								<SelectContent>
									{language.map((lang) => (
										<SelectItem key={lang.id} value={lang.language}>
											{lang.display}
										</SelectItem>
									))}
								</SelectContent>
							</Select>
						</div>

						{/* Submit Button */}
						<Button
							type="submit"
							className="w-full"
							disabled={isLoading || !selectedImage || !selectedCity}
						>
							{isLoading ? (
								<>
									<Loader2 className="mr-2 h-4 w-4 animate-spin" />
									Submitting...
								</>
							) : (
								"Submit"
							)}
						</Button>
					</form>
				</CardContent>
			</Card>
			<StreamingResponse
				isOpen={showResponse}
				onOpenChange={setShowResponse}
				location={selectedCity}
				imageClass={imageClass}
			/>
		</>
	);
}
