from pydantic import BaseModel


class UploadOut(BaseModel):
    url: str
