from pydantic import BaseModel, EmailStr
from typing import Optional
from datetime import datetime


class UserCreate(BaseModel):
    email: EmailStr
    password: str
    phone_number: Optional[str] = None


class UserOut(BaseModel):
    id: int
    email: EmailStr
    phone_number: Optional[str] = None
    created_at: datetime

    class Config:
        orm_mode = True


class Token(BaseModel):
    access_token: str
    token_type: str = "bearer"
    # optional refresh token
    refresh_token: Optional[str] = None


class TokenData(BaseModel):
    email: Optional[EmailStr] = None
