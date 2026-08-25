import json
import logging
from pypdf import PdfReader
import google.generativeai as genai
from app.config import settings

logger = logging.getLogger(__name__)

if settings.GEMINI_API_KEY:
    genai.configure(api_key=settings.GEMINI_API_KEY)

def parse_resume_with_gemini(filepath: str) -> dict:
    """
    Extracts text from a resume PDF and uses Gemini to parse it into structured data.
    """
    try:
        # 1. Extract text from PDF
        reader = PdfReader(filepath)
        text = ""
        for page in reader.pages:
            text += page.extract_text() + "\n"
            
        if not text.strip():
            logger.warning(f"No text extracted from {filepath}")
            return {}

        # 2. Ask Gemini to extract structured info
        prompt = f"""
You are an expert technical recruiter and resume parser.
Extract the following information from the provided resume text and return it as a pure JSON object.
Do NOT include markdown backticks (like ```json) or any other text in your response, just the raw JSON.

Required JSON structure:
{{
    "cgpa": float (e.g. 8.5),
    "branch": string (e.g. "Computer Science", "CSE"),
    "batch": int (e.g. 2024),
    "linkedin_url": string (or null if not found),
    "github_url": string (or null if not found),
    "skills": [
        "Python", "React", "Docker", ... (list of strings, max 15 key skills)
    ]
}}

Resume text:
{text}
"""
        model = genai.GenerativeModel(settings.GEMINI_MODEL)
        response = model.generate_content(prompt)
        
        raw = response.text.strip()
        if raw.startswith("```json"):
            raw = raw[7:]
        if raw.startswith("```"):
            raw = raw[3:]
        if raw.endswith("```"):
            raw = raw[:-3]
            
        parsed = json.loads(raw)
        return parsed
    except Exception as e:
        logger.error(f"Error parsing resume {filepath}: {e}")
        return {}
