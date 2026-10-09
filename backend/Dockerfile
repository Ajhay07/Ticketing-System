FROM python:3.11-slim

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

EXPOSE 8000

# Shell form (not exec form) so $PORT is substituted at runtime - needed for
# hosts like Railway/Render that assign their own port via env var. Falls
# back to 8000 for local `docker compose up` where PORT isn't set.
CMD sh start.sh
