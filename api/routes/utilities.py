"""
api/routes/utilities.py — PDF CV intake and Word (.docx) export endpoints.
"""

import io
import logging
import re

import pdfplumber
from docx import Document
from fastapi import APIRouter, File, HTTPException, UploadFile
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field

logger = logging.getLogger(__name__)

router = APIRouter()

_MAX_PDF_BYTES = 10 * 1024 * 1024  # 10 MB


class DocxExportRequest(BaseModel):
    title: str = Field("Ascend AI Document", min_length=1, max_length=180)
    content: str = Field(..., min_length=1)
    filename: str = Field("ascend-document.docx", max_length=120)


@router.post("/inputs/parse-cv", summary="Extract readable plain text from an uploaded PDF CV")
async def parse_cv_endpoint(file: UploadFile = File(...)):
    filename = file.filename or "cv.pdf"
    if not filename.lower().endswith(".pdf"):
        raise HTTPException(status_code=422, detail="Only .pdf files are supported.")

    raw_bytes = await file.read()
    if not raw_bytes:
        raise HTTPException(status_code=422, detail="Uploaded PDF file is empty.")
    if len(raw_bytes) > _MAX_PDF_BYTES:
        raise HTTPException(status_code=413, detail="PDF exceeds maximum 10 MB size limit.")

    try:
        pages_text: list[str] = []
        with pdfplumber.open(io.BytesIO(raw_bytes)) as pdf:
            page_count = len(pdf.pages)
            for page in pdf.pages:
                extracted = page.extract_text()
                if extracted:
                    pages_text.append(extracted.strip())

        combined = "\n\n".join(pages_text).strip()
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
def export_docx_endpoint(req: DocxExportRequest):
    doc = Document()
    doc.add_heading(req.title, level=0)

    for block in req.content.split("\n\n"):
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
