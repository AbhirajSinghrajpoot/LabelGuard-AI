import threading
from typing import Callable

import cv2
import numpy as np
from paddleocr import PaddleOCR


class OCRProcessingError(RuntimeError):
    pass


_engine = None
_initialization_lock = threading.Lock()
_inference_lock = threading.Lock()


def _get_engine():
    global _engine
    if _engine is None:
        with _initialization_lock:
            if _engine is None:
                try:
                    _engine = PaddleOCR(
                        use_angle_cls=True,
                        lang="en",
                        use_gpu=False,
                        show_log=False,
                    )
                except Exception as exc:
                    raise OCRProcessingError("PaddleOCR could not be initialized.") from exc
    return _engine


def _normalize_results(ocr_output) -> list[dict]:
    results = []
    for page in ocr_output or []:
        for line in page or []:
            if not isinstance(line, (list, tuple)) or len(line) < 2:
                continue
            box, recognition = line[0], line[1]
            if not isinstance(recognition, (list, tuple)) or len(recognition) < 2:
                continue

            text = str(recognition[0]).strip()
            if not text:
                continue

            bounding_box = [
                [round(float(point[0]), 2), round(float(point[1]), 2)]
                for point in box
            ]
            results.append({
                "text": text,
                "confidence": round(float(recognition[1]), 4),
                "bounding_box": bounding_box,
            })
    return results


def _run_ocr(engine, image: np.ndarray) -> list[dict]:
    return _normalize_results(engine.ocr(image, cls=True))


def _average_confidence(results: list[dict]) -> float:
    if not results:
        return 0.0
    return sum(result["confidence"] for result in results) / len(results)


def extract_text(
    image: np.ndarray,
    preprocess: Callable[[np.ndarray], np.ndarray],
) -> tuple[list[dict], bool]:
    try:
        with _inference_lock:
            engine = _get_engine()
            original_results = _run_ocr(engine, image)

            # Multi-angle pass for vertical / rotated product packaging and inkjet stamps
            rotated_results = []
            try:
                rot90 = cv2.rotate(image, cv2.ROTATE_90_CLOCKWISE)
                res90 = _run_ocr(engine, rot90)
                seen_texts = set(r["text"].lower().replace(" ", "") for r in original_results)
                for r in res90:
                    cleaned = r["text"].lower().replace(" ", "")
                    if len(cleaned) > 2 and cleaned not in seen_texts:
                        seen_texts.add(cleaned)
                        rotated_results.append(r)
            except Exception:
                pass

            combined_results = list(original_results) + rotated_results

            if combined_results and (len(combined_results) >= 3 or _average_confidence(combined_results) >= 0.70):
                return combined_results, False

            processed_results = _run_ocr(engine, preprocess(image))
            if _average_confidence(processed_results) > _average_confidence(combined_results):
                return processed_results, True
            return combined_results, False
    except OCRProcessingError:
        raise
    except Exception as exc:
        raise OCRProcessingError("PaddleOCR could not extract text from the image.") from exc
