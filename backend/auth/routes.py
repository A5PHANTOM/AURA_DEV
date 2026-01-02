from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session
from .. import models, schemas
from ..database import get_db
from .utils import get_password_hash, verify_password
from .jwt_handler import create_access_token
from datetime import timedelta
from .. import config
from .jwt_handler import create_access_token
from fastapi.security import OAuth2PasswordRequestForm

router = APIRouter(prefix="/auth", tags=["auth"])


@router.post('/register', response_model=schemas.UserOut)
def register(user_in: schemas.UserCreate, db: Session = Depends(get_db)):
    # check if user exists
    existing_email = db.query(models.User).filter(models.User.email == user_in.email).first()
    if existing_email:
        raise HTTPException(status_code=400, detail="Email already registered")

    if user_in.phone_number:
        existing_phone = db.query(models.User).filter(models.User.phone_number == user_in.phone_number).first()
        if existing_phone:
            raise HTTPException(status_code=400, detail="Phone number already registered")

    hashed = get_password_hash(user_in.password)
    user = models.User(email=user_in.email, hashed_password=hashed, phone_number=user_in.phone_number)
    db.add(user)
    db.commit()
    db.refresh(user)
    return user


@router.post('/login', response_model=schemas.Token)
def login(form_data: OAuth2PasswordRequestForm = Depends(), db: Session = Depends(get_db)):
    # allow username to be email or phone number
    user = db.query(models.User).filter(
        (models.User.email == form_data.username) | (models.User.phone_number == form_data.username)
    ).first()
    if not user:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Incorrect email or password")

    if not verify_password(form_data.password, user.hashed_password):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Incorrect email or password")

    # create tokens
    access_token_expires = timedelta(minutes=int(config.ACCESS_TOKEN_EXPIRE_MINUTES))
    access_token = create_access_token(data={"sub": user.email}, expires_delta=access_token_expires)

    # refresh token with longer expiry
    refresh_expires = timedelta(days=int(config.REFRESH_TOKEN_EXPIRE_DAYS))
    refresh_token = create_access_token(data={"sub": user.email, "type": "refresh"}, expires_delta=refresh_expires)
    return {"access_token": access_token, "token_type": "bearer", "refresh_token": refresh_token}
