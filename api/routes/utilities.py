"""
api/routes/utilities.py — PDF CV intake and Word (.docx) export endpoints.
"""

import io
import logging
import re

import pdfplumber
from docx import Document
from fastapi import APIRouter, Depends, File, HTTPException, Request, UploadFile
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field

import config
from api.demo import require_client_id
from api.rate_limit import enforce_rate_limit

logger = logging.getLogger(__name__)

router = APIRouter()

_MAX_PDF_BYTES = 10 * 1024 * 1024  # 10 MB
_PDF_CHUNK_BYTES = 64 * 1024  # 64 KB streaming read chunk
_MAX_PDF_PAGES = 25
_MAX_EXTRACTED_CHARS = 50_000
_MAX_DOCX_CONTENT_CHARS = 120_000


class DocxExportRequest(BaseModel):
    title: str = Field("Ascend AI Document", min_length=1, max_length=180)
    content: str = Field(..., min_length=1, max_length=_MAX_DOCX_CONTENT_CHARS)
    filename: str = Field("ascend-document.docx", max_length=120)


async def _read_upload_bounded(file: UploadFile, max_bytes: int) -> bytes:
    """Stream upload in chunks so oversized payloads cannot exhaust server RAM."""
    chunks: list[bytes] = []
    total = 0
    while True:
        chunk = await file.read(_PDF_CHUNK_BYTES)
        if not chunk:
            break
        total += len(chunk)
        if total > max_bytes:
            raise HTTPException(status_code=413, detail="PDF exceeds maximum 10 MB size limit.")
        chunks.append(chunk)
    return b"".join(chunks)


@router.post("/inputs/parse-cv", summary="Extract readable plain text from an uploaded PDF CV")
async def parse_cv_endpoint(
    request: Request,
    file: UploadFile = File(...),
    client_id: str = Depends(require_client_id),
):
    enforce_rate_limit(
        request,
        bucket="parse_cv",
        limit=config.RATE_LIMIT_CV_PARSE_PER_HOUR,
        client_id=client_id,
    )

    filename = re.sub(r"[^a-zA-Z0-9._ -]", "_", (file.filename or "cv.pdf").split("/")[-1].split("\\")[-1])[:120]
    if not filename.lower().endswith(".pdf"):
        raise HTTPException(status_code=422, detail="Only .pdf files are supported.")

    raw_bytes = await _read_upload_bounded(file, _MAX_PDF_BYTES)
    if not raw_bytes:
        raise HTTPException(status_code=422, detail="Uploaded PDF file is empty.")
    if not raw_bytes.startswith(b"%PDF-"):
        raise HTTPException(
            status_code=422,
            detail="Uploaded file is not a valid PDF document (invalid file signature).",
        )

    try:
        pages_text: list[str] = []
        total_chars = 0
        with pdfplumber.open(io.BytesIO(raw_bytes)) as pdf:
            page_count = len(pdf.pages)
            if page_count == 0:
                raise HTTPException(status_code=422, detail="Uploaded PDF has no pages.")
            if page_count > _MAX_PDF_PAGES:
                raise HTTPException(
                    status_code=422,
                    detail=f"PDF exceeds maximum {_MAX_PDF_PAGES}-page CV limit.",
                )
            for page in pdf.pages:
                extracted = page.extract_text()
                if not extracted:
                    continue
                cleaned = extracted.strip()
                if not cleaned:
                    continue
                remaining = _MAX_EXTRACTED_CHARS - total_chars
                if remaining <= 0:
                    break
                piece = cleaned[:remaining]
                pages_text.append(piece)
                total_chars += len(piece)
                if total_chars >= _MAX_EXTRACTED_CHARS:
                    break

        combined = "\n\n".join(pages_text).strip()[:_MAX_EXTRACTED_CHARS]
        if not combined:
            raise HTTPException(
                status_code=422,
                detail="No readable text found in PDF (it may be a scanned image). Please paste notes instead.",
            )

        return {
            "filename": filename,
            "page_count": page_count,
            "char_count": len(combined),
            "text": combined,
        }
    except HTTPException:
        raise
    except Exception as exc:
        logger.warning("PDF parse failed (%s)", type(exc).__name__)
        raise HTTPException(
            status_code=422,
            detail="Could not parse this PDF file. Please verify it is a valid text-based PDF or paste notes instead.",
        ) from exc


@router.post("/export/docx", summary="Export generated SOP, Proposal, or Report as a .docx Word file")
def export_docx_endpoint(
    req: DocxExportRequest,
    request: Request,
    client_id: str = Depends(require_client_id),
):
    enforce_rate_limit(
        request,
        bucket="export_docx",
        limit=config.RATE_LIMIT_EXPORT_PER_HOUR,
        client_id=client_id,
    )

    doc = Document()
    doc.add_heading(req.title, level=0)

    for block in req.content.split("\n\n")[:400]:
        cleaned = block.strip()
        if cleaned:
            doc.add_paragraph(cleaned)

    bio = io.BytesIO()
    doc.save(bio)
    bio.seek(0)

    safe_name = re.sub(r"[^a-zA-Z0-9._-]", "_", req.filename.strip() or "document.docx")
    if not safe_name.lower().endswith(".docx"):
        safe_name += ".docx"

    return StreamingResponse(
        bio,
        media_type="application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        headers={"Content-Disposition": f'attachment; filename="{safe_name}"'},
    )
