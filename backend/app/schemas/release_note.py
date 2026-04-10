from pydantic import BaseModel, Field


class ReleaseNotePublishIn(BaseModel):
    version: str = Field(..., min_length=1, max_length=64)
    title: str = Field(..., min_length=1, max_length=255)
    body: str = Field(..., min_length=1)
