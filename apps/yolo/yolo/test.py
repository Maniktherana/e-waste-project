from ultralytics import YOLO
import cv2
import os

model = YOLO(os.path.join(os.getcwd(), "best.pt"))

def image(path, out_path=None):
    img = cv2.imread(path)

    if img is None:
        print("Image not found")

    results = model.predict(source=img, save=False, conf=0.25)
    detections = results[0].boxes.data.cpu().numpy()

    for detection in detections:
        x1, y1, x2, y2, conf, classname = detection
        label = f"{model.names[int(classname)]} {conf:.2f}"

        cv2.rectangle(img, (int(x1), int(y1)), (int(x2), int(y2)), (0, 255, 0), 2)
        cv2.putText(img, label, (int(x1), int(y1) - 10), cv2.FONT_HERSHEY_SIMPLEX, 0.5, (0, 255, 0), 2)

    # cv2.imwrite(output_image_path, image)
    cv2.imshow("Detections", img)
    cv2.waitKey(0)
    cv2.destroyAllWindows()


def vid(video_path, output_path):
    cap = cv2.VideoCapture(video_path)
    fps = int(cap.get(cv2.CAP_PROP_FPS))
    frame_width = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
    frame_height = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))

    fourcc = cv2.VideoWriter_fourcc(*'mp4v')
    out = cv2.VideoWriter(output_path, fourcc, fps, (frame_width, frame_height))

    while cap.isOpened():
        ret, frame = cap.read()
        if not ret:
            break

        results = model.predict(source=frame, save=False, save_txt=False, conf=0.25)

        detections = results[0].boxes.data.cpu().numpy()
        for detection in detections:
            x1, y1, x2, y2, conf, cls = detection
            label = f"{model.names[int(cls)]} {conf:.2f}"
            cv2.rectangle(frame, (int(x1), int(y1)), (int(x2), int(y2)), (0, 255, 0), 2)
            cv2.putText(frame, label, (int(x1), int(y1) - 10), cv2.FONT_HERSHEY_SIMPLEX, 0.5, (0, 255, 0), 2)

        out.write(frame)

        cv2.imshow("Detections", frame)
        if cv2.waitKey(1) & 0xFF == ord('q'):
            break

    cap.release()
    out.release()
    cv2.destroyAllWindows()


image(os.path.join(os.getcwd(), "test.png"))

# test 20 images randomly from the random_test directory. this directory has 10 different directories. select a random directory and random image from that directory 20 times
# directories = ["Battery", "Keyboard", "Printer", "Player", "Microwave", "Mobile", "Television", "WashingMachine"]
# for i in range(20):
#     random_directory = os.path.join(os.getcwd(), "random_test", directories[i % 8])
#     random_image = os.path.join(random_directory, os.listdir(random_directory)[i % len(os.listdir(random_directory))])
#     image(random_image)

# test all images in test/imags directory
# for img in os.listdir(os.path.join(os.getcwd(), "test", "images")):
#     image(os.path.join(os.getcwd(), "test", "images", img))