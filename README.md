# AudioHub

AudioHub is our senior capstone project and a social Spotify data analytics app that allows Spotify Premium users to create account and upload their extended Spotify listening history to create and explore insights about their habits and history, see other users' and global streaming insights, and get artist/song recommendations from on a trained ML model.

## Project Structure

```text
audiohub/
├── apps/
│   ├── web/        # Next.js frontend
│   └── api/        # FastAPI backend
├── supabase/       # Database, auth, and storage configuration
└── README.md
```

## Prerequisites

To get the project development environment set up, it is required to have the following installed:

- Node.js (v22+ recommended; started with v22.17.0)
- Python 3.11+ (started with 3.14.3)
- Docker/Docker Desktop (required for local Supabase)
- Supabase CLI

## Supabase Install (Using Node Package Manager/npm)
```bash
npm install
```
## Cloning the Repo
```bash
git clone <repository-url>
cd audio-hub
```

## Next.js Setup
From the project root, run
```bash
npm run dev
```

This starts the frontend and local Supabase dev services. You can view the frontend at http://localhost:3000

## Backend Setup
```bash
cd apps/api

python -m venv .venv # creates virtual environment
source .venv/bin/activate # activates the virtual environment for backend dev

pip install -r requirements.txt # self explanatory
```

To run the API, enter:
```bash
python -m uvicorn app.main:app --reload
```
And look to http://localhost:8000
with API docs at http://localhost:8000/docs

## Environment Setup
There are .env.example files in the /apps/api/ and /apps/web/ folders that show the necessary structure for .env files
that must be present in their given directories. These are necessary for the application to run, and can be retrieved by
contacting one of the developers.

## Dev Workflow
During dev, you will run
```bash
npm run dev
```
from the project root for the frontend and Supabase, and the backend separately from apps/api