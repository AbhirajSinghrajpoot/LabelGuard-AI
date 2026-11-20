from io import BytesIO

import cv2
import fitz
import numpy as np
from PIL import Image, UnidentifiedImageError

MAX_UPLOAD_SIZE = 10 * 1024 * 1024
MAX_IMAGE_PIXELS = 40_000_000
MAX_PDF_PAGES = 10
MAX_PDF_TOTAL_PIXELS = 60_000_000
PDF_RENDER_SCALE = 2


class ImageValidationError(ValueError):
    pass


def decode_image(content: bytes) -> np.ndarray:
    try:
        with Image.open(BytesIO(content)) as image:
            width, height = image.size
            image.verify()
    except (UnidentifiedImageError, OSError, Image.DecompressionBombError) as exc:
        raise ImageValidationError("The file is not a valid or readable image.") from exc

    if width <= 0 or height <= 0 or width * height > MAX_IMAGE_PIXELS:
        raise ImageValidationError("The image dimensions are too large to process.")

    try:
        decoded = cv2.imdecode(np.frombuffer(content, dtype=np.uint8), cv2.IMREAD_COLOR)
    except cv2.error as exc:
        raise ImageValidationError("The file is not a valid or readable image.") from exc
    if decoded is None:
        raise ImageValidationError("The file is not a valid or readable image.")
    # Optimize image dimensions for fast and accurate CPU OCR processing
    h, w = decoded.shape[:2]
    max_dim = 1600
    if max(h, w) > max_dim:
        scale = max_dim / max(h, w)
        new_w, new_h = int(w * scale), int(h * scale)
        decoded = cv2.resize(decoded, (new_w, new_h), interpolation=cv2.INTER_AREA)
    return decoded


def decode_pdf_pages(content: bytes) -> list[np.ndarray]:
    try:
        document = fitz.open(stream=content, filetype="pdf")
    except (fitz.FileDataError, fitz.EmptyFileError, RuntimeError) as exc:
        raise ImageValidationError("The file is not a valid or readable PDF.") from exc

    with document:
        if document.is_encrypted:
            raise ImageValidationError("Password-protected PDFs are not supported.")
        if document.page_count == 0:
            raise ImageValidationError("The PDF does not contain any pages.")
        if document.page_count > MAX_PDF_PAGES:
            raise ImageValidationError(f"PDFs may contain at most {MAX_PDF_PAGES} pages.")

        pages = []
        total_pixels = 0
        for page in document:
            width = int(page.rect.width * PDF_RENDER_SCALE)
            height = int(page.rect.height * PDF_RENDER_SCALE)
            pixels = width * height
            if width <= 0 or height <= 0 or pixels > MAX_IMAGE_PIXELS:
                raise ImageValidationError("A PDF page is too large to process.")
            total_pixels += pixels
            if total_pixels > MAX_PDF_TOTAL_PIXELS:
                raise ImageValidationError("The PDF contains too many pixels to process.")

            try:
                pixmap = page.get_pixmap(
                    matrix=fitz.Matrix(PDF_RENDER_SCALE, PDF_RENDER_SCALE),
                    colorspace=fitz.csRGB,
                    alpha=False,
                )
            except (RuntimeError, ValueError) as exc:
                raise ImageValidationError("A PDF page could not be rendered.") from exc

            rgb_image = np.frombuffer(pixmap.samples, dtype=np.uint8).reshape(
                pixmap.height,
                pixmap.width,
                pixmap.n,
            )
            pages.append(cv2.cvtColor(rgb_image, cv2.COLOR_RGB2BGR))
        return pages


def preprocess_image(image: np.ndarray) -> np.ndarray:
    grayscale = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)
    denoised = cv2.fastNlMeansDenoising(
        grayscale,
        None,
        h=10,
        templateWindowSize=7,
        searchWindowSize=21,
    )
    return cv2.adaptiveThreshold(
        denoised,
        255,
        cv2.ADAPTIVE_THRESH_GAUSSIAN_C,
        cv2.THRESH_BINARY,
        31,
        11,
    )


def get_quality_warnings(image: np.ndarray) -> list[str]:
    height, width = image.shape[:2]
    grayscale = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)
    warnings = []

    if min(width, height) < 300:
        warnings.append("The image resolution is low; small text may be missed.")
    if cv2.Laplacian(grayscale, cv2.CV_64F).var() < 40:
        warnings.append("The image may be blurry; try a sharper photo.")

    brightness = float(np.mean(grayscale))
    if brightness < 25 or brightness > 245:
        warnings.append("The image may be too dark or too bright.")
    return warnings
