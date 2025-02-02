from fastapi import FastAPI, File, UploadFile, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from PIL import Image
import torch
from torchvision import transforms
import torch.nn as nn
from torchvision import models
import io
import os

# Initialize FastAPI
app = FastAPI(title="ML Inference API")

# Configure CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Device configuration
device = torch.device("cuda" if torch.cuda.is_available() else "cpu")

# Model configuration
def load_model():
    model = models.resnet34(pretrained=True)
    num_classes = 10
    model.fc = nn.Linear(model.fc.in_features, num_classes)
    
    # Load weights from file in the same directory
    model_path = os.path.join(
        os.path.dirname(__file__),  # Location of main.py
        "weights",                  # weights directory
        "model.pkt"                 # model file name
    )
    model.load_state_dict(torch.load(model_path, map_location=device))
    
    model.eval()
    return model.to(device)

model = load_model()

# Category mapping
category_map = {
    0: 'Battery', 1: 'Keyboard', 2: 'Microwave', 
    3: 'Mobile', 4: 'Mouse', 5: 'PCB', 
    6: 'Player', 7: 'Printer', 8: 'Television', 
    9: 'WashingMachine'
}

# Image transformations
transform = transforms.Compose([
    transforms.Resize((224, 224)),
    transforms.RandomHorizontalFlip(),
    transforms.ToTensor(),
    transforms.Normalize([0.485, 0.456, 0.406], [0.229, 0.224, 0.225])
])

@app.post("/predict/")
async def predict(file: UploadFile = File(...)):
    # Validate file type
    if not file.content_type.startswith('image/'):
        raise HTTPException(
            status_code=400, 
            detail="Invalid file type. Please upload an image."
        )

    try:
        # Read image file
        contents = await file.read()
        image = Image.open(io.BytesIO(contents)).convert('RGB')
        
        # Apply transformations
        input_tensor = transform(image).unsqueeze(0).to(device)
        
        # Run inference
        with torch.no_grad():
            outputs = model(input_tensor)
            _, predicted = torch.max(outputs, 1)
            prediction = predicted.item()
        
        return {
            "class_id": prediction,
            "class_name": category_map[prediction],
            "confidence": outputs.softmax(1)[0][prediction].item()
        }
        
    except Exception as e:
        raise HTTPException(
            status_code=500, 
            detail=f"Error processing image: {str(e)}"
        )

@app.get("/health")
def health_check():
    return {"status": "healthy", "device": str(device)}

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)