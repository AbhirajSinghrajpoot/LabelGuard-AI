import logging
from pathlib import Path

from fastapi import FastAPI, File, HTTPException, UploadFile
from starlette.concurrency import run_in_threadpool

from image_processor import (
    MAX_UPLOAD_SIZE,
    ImageValidationError,
    decode_image,
    decode_pdf_pages,
    get_quality_warnings,
    preprocess_image,
)
from ocr_engine import OCRProcessingError, extract_text

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

IMAGE_EXTENSIONS = {".jpg", ".jpeg", ".png", ".webp"}
ALLOWED_EXTENSIONS = IMAGE_EXTENSIONS | {".pdf"}

app = FastAPI(
    title="Product Label AI Service",
    description="Image intake and PaddleOCR text extraction service",
    version="1.0.0",
)


@app.get("/")
def home():
    return {"message": "Product Label AI Service is running!"}


@app.get("/api/health")
def health():
    return {
        "status": "success",
        "service": "Python AI Service",
        "ocr_engine": "PaddleOCR",
        "message": "AI service is working properly",
    }


@app.post("/api/image/inspect")
async def inspect_image(file: UploadFile = File(...)):
    try:
        filename = Path(file.filename or "").name
        if not filename or Path(filename).suffix.lower() not in ALLOWED_EXTENSIONS:
            raise HTTPException(
                status_code=415,
                detail="Upload a JPG, JPEG, PNG, WEBP image or PDF.",
            )

        content = await file.read(MAX_UPLOAD_SIZE + 1)
        if not content:
            raise HTTPException(status_code=400, detail="The uploaded file is empty.")
        if len(content) > MAX_UPLOAD_SIZE:
            raise HTTPException(status_code=413, detail="The file must be 10 MB or smaller.")

        try:
            if Path(filename).suffix.lower() == ".pdf":
                images = decode_pdf_pages(content)
            else:
                images = [decode_image(content)]
        except ImageValidationError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc

        results = []
        quality_warnings = []
        processed = False
        for page_number, image in enumerate(images, start=1):
            quality_warnings.extend(
                f"Page {page_number}: {warning}"
                for warning in get_quality_warnings(image)
            )
            try:
                page_results, page_processed = await run_in_threadpool(
                    extract_text,
                    image,
                    preprocess_image,
                )
            except OCRProcessingError as exc:
                logger.exception("PaddleOCR failed to inspect %s page %s", filename, page_number)
                raise HTTPException(
                    status_code=500,
                    detail="OCR processing failed. Please try again.",
                ) from exc
            results.extend({**result, "page_number": page_number} for result in page_results)
            processed = processed or page_processed

        extracted_text = "\n".join(result["text"] for result in results)
        first_page = images[0]
        return {
            "status": "success",
            "filename": filename,
            "ocr_engine": "PaddleOCR",
            "total_lines": len(results),
            "extracted_text": extracted_text,
            "results": results,
            "width": int(first_page.shape[1]),
            "height": int(first_page.shape[0]),
            "page_count": len(images),
            "processed_image_used": processed,
            "quality_warnings": list(dict.fromkeys(quality_warnings)),
        }
    finally:
        await file.close()
