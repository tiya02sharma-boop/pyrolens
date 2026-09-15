# Stage 1: build the React/Vite frontend
FROM node:20-slim AS frontend
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm install
COPY src ./src
COPY index.html vite.config.js ./
RUN npm run build

# Stage 2: Python backend, serving the built frontend as static files
FROM python:3.11-slim
WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends libpq-dev gcc && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY app.py .
COPY gis ./gis
COPY models ./models
COPY outputs/firms_combined_with_predictions_v2.csv ./outputs/firms_combined_with_predictions_v2.csv
COPY --from=frontend /app/dist ./dist

# NOT copied: models/model_random_forest_v2.joblib, data/, notebooks/, original_pipeline/
# -- none of these are read by app.py at runtime; excluding them keeps the image lean.

ENV PORT=8000
EXPOSE 8000
CMD ["sh", "-c", "uvicorn app:app --host 0.0.0.0 --port ${PORT}"]
