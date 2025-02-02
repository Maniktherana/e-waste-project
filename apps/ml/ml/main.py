import logging
from fastapi import FastAPI, File, UploadFile, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from PIL import Image
import torch
from torchvision import transforms
from torchvision.models import resnet34, ResNet34_Weights
import torch.nn as nn
import io
import os

# Set up logging
logging.basicConfig(level=logging.DEBUG)
logger = logging.getLogger(__name__)

# Initialize FastAPI
app = FastAPI(title="ML Inference API")

# Configure CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["GET", "POST", "OPTIONS"],  # Explicitly define allowed methods
    allow_headers=["*"],
)

# Device configuration
device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
logger.info(f"Using device: {device}")


# Model configuration
def load_model():
    logger.info("Loading model...")

    # Load the pre-trained ResNet-34 model with the ImageNet weights
    model = resnet34(
        weights=ResNet34_Weights.IMAGENET1K_V1
    )  # Use the correct enum for weights
    num_classes = 10
    model.fc = nn.Linear(model.fc.in_features, num_classes)

    # Load weights from file in the same directory
    model_path = os.path.join(
        os.path.dirname(__file__),  # Location of main.py
        "weights",  # weights directory
        "model.pth",  # model file name
    )

    if os.path.exists(model_path):
        # If custom weights file is available, load it
        logger.info(f"Loading custom model weights from {model_path}")
        model.load_state_dict(torch.load(model_path, map_location=device))
    else:
        logger.warning(
            f"Model file not found at {model_path}. Using default pretrained weights."
        )

    model.eval()
    logger.info("Model loaded successfully.")
    return model.to(device)


model = load_model()

# Category mapping
category_map = {
    0: "Battery",
    1: "Keyboard",
    2: "Microwave",
    3: "Mobile",
    4: "Mouse",
    5: "PCB",
    6: "Player",
    7: "Printer",
    8: "Television",
    9: "WashingMachine",
}

# Image transformations
transform = transforms.Compose(
    [
        transforms.Resize((224, 224)),
        transforms.RandomHorizontalFlip(),
        transforms.ToTensor(),
        transforms.Normalize([0.485, 0.456, 0.406], [0.229, 0.224, 0.225]),
    ]
)


@app.post("/predict/")
async def predict(file: UploadFile = File(...)):
    logger.info(f"Received file: {file.filename}")

    # Validate file type
    if not file.filename.lower().endswith((".png", ".jpg", ".jpeg")):
        logger.warning(f"Invalid file type: {file.filename}")
        raise HTTPException(
            status_code=400, detail="Invalid file type. Please upload an image."
        )

    try:
        # Read image file
        contents = await file.read()
        image = Image.open(io.BytesIO(contents)).convert("RGB")

        # Apply transformations
        input_tensor = transform(image).unsqueeze(0).to(device)

        # Run inference
        with torch.no_grad():
            outputs = model(input_tensor)
            _, predicted = torch.max(outputs, 1)
            prediction = predicted.item()

        logger.info(
            f"Prediction made: {prediction} - {category_map[prediction]} with confidence {outputs.softmax(1)[0][prediction].item():.4f}"
        )

        return {
            "class_id": prediction,
            "class_name": category_map[prediction],
            "confidence": outputs.softmax(1)[0][prediction].item(),
        }

    except Exception as e:
        logger.error(f"Error processing image: {str(e)}")
        raise HTTPException(status_code=500, detail=f"Error processing image: {str(e)}")


@app.get("/health")
def health_check():
    logger.info("Health check request received.")
    return {"status": "healthy", "device": str(device)}


if __name__ == "__main__":
    import uvicorn

    logger.info("Starting FastAPI CUSTOM LOG app...")
    uvicorn.run(app, host="0.0.0.0", port=5001)
