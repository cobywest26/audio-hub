export const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL!;

export type RecommendationItem = {
  rank: number;
  track_id: string;
  track_name: string | null;
  artists: string | null;
  genre: string | null;
  popularity: number | null;
  score: number | null;
  source: string | null;
  reason: string | null;
  spotify_uri?: string | null;
  external_url?: string | null;
};

export type RecommendationBatch = {
  id: string;
  user_id: string;
  strategy: string;
  coverage: RecommendationCoverage;
  created_at: string;
};

export type RecommendationCoverage = {
  total_interactions: number;
  matched_interactions: number;
  total_unique_tracks: number;
  matched_unique_tracks: number;
  match_rate: number;
};

export type RecommendationResponse = {
  has_recommendations: boolean;
  batch: RecommendationBatch | null;
  recommendations: RecommendationItem[];
  strategy?: string;
  coverage?: RecommendationCoverage;
};

export type SpotifyPlaylistExportResult = {
  id: string;
  external_urls?: {
    spotify?: string;
  };
};

export async function uploadSpotifyData(
  file: File,
  accessToken: string
) {
  const formData = new FormData();
  formData.append("file", file);

  const response = await fetch(`${API_BASE_URL}/upload/`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
    body: formData,
  });

  const data = await response.json();

  if (!response.ok) {
    throw new Error(data.detail || "Upload failed.");
  }

  return data;
}

export async function getLatestMetrics(accessToken: string) {
  const response = await fetch(`${API_BASE_URL}/metrics/latest`, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  });

  const data = await response.json();

  if (!response.ok) {
    throw new Error(data.detail || "Failed to fetch latest metrics.");
  }

  return data;
}

export async function getProfileMetrics(accessToken: string) {
  const response = await fetch(`${API_BASE_URL}/metrics/me`, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  });

  const data = await response.json();

  if (!response.ok) {
    throw new Error(data.detail || "Failed to fetch profile metrics.");
  }

  return data;
}

export async function getSnapshots(accessToken: string) {
  const response = await fetch(`${API_BASE_URL}/metrics/snapshots`, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  });

  const data = await response.json();

  if (!response.ok) {
    throw new Error(data.detail || "Failed to fetch snapshots.");
  }

  return data;
}

export async function resetForNewSnapshot(accessToken: string) {
    const response = await fetch(`${API_BASE_URL}/metrics/reset`, {
        method: "POST",
        headers: {
            Authorization: `Bearer ${accessToken}`,
        },
    });

    const data = await response.json();

    if (!response.ok) {
        throw new Error(data.detail || "Failed to prepare for new snapshot.");
    }

    return data;
}

export async function renameSnapshot(
  accessToken: string,
  snapshotId: string,
  name: string
) {
  const response = await fetch(
    `${API_BASE_URL}/metrics/snapshots/${snapshotId}`,
    {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify({ name }),
    }
  );

  const data = await response.json().catch(() => null);

  if (!response.ok) {
    throw new Error(data?.detail || data?.message || "Failed to rename snapshot");
  }

  return data;
}

// Fetches aggregate listening metrics across the latest snapshots from each user
export async function getGlobalMetrics(accessToken: string) {
  const response = await fetch(`${API_BASE_URL}/metrics/global`, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  });

  const data = await response.json();

  if (!response.ok) {
    throw new Error(data.detail || "Failed to fetch global metrics.");
  }

  return data;
}

export async function getMyRecommendations(
  accessToken: string
): Promise<RecommendationResponse> {
  const response = await fetch(`${API_BASE_URL}/recommender/me`, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  });

  const data = await response.json();

  if (!response.ok) {
    throw new Error(data.detail || "Failed to fetch recommendations.");
  }

  return data;
}

export async function generateRecommendations(
  accessToken: string,
  options: {
    limit?: number;
    useExternalDiscovery?: boolean;
    useLightfmRerank?: boolean;
  } = {}
): Promise<RecommendationResponse> {
  const params = new URLSearchParams();

  if (options.limit) {
    params.set("limit", String(options.limit));
  }
  if (typeof options.useExternalDiscovery === "boolean") {
    params.set("use_external_discovery", String(options.useExternalDiscovery));
  }
  if (typeof options.useLightfmRerank === "boolean") {
    params.set("use_lightfm_rerank", String(options.useLightfmRerank));
  }

  const response = await fetch(`${API_BASE_URL}/recommender/generate?${params.toString()}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  });

  const data = await response.json();

  if (!response.ok) {
    throw new Error(data.detail || "Failed to generate recommendations.");
  }

  return data;
}

export async function createSpotifyPlaylist(
  providerToken: string,
  options: {
    name: string;
    description?: string;
    public?: boolean;
  }
): Promise<SpotifyPlaylistExportResult> {
  const response = await fetch("https://api.spotify.com/v1/me/playlists", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${providerToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      name: options.name,
      description: options.description ?? "",
      public: options.public ?? false,
    }),
  });

  const data = await response.json().catch(() => null);

  if (!response.ok) {
    throw new Error(data?.error?.message || "Failed to create Spotify playlist.");
  }

  return data;
}

export async function addTracksToSpotifyPlaylist(
  providerToken: string,
  playlistId: string,
  trackUris: string[]
) {
  const response = await fetch(`https://api.spotify.com/v1/playlists/${playlistId}/items`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${providerToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      uris: trackUris,
    }),
  });

  const data = await response.json().catch(() => null);

  if (!response.ok) {
    throw new Error(data?.error?.message || "Failed to add tracks to Spotify playlist.");
  }

  return data;
}
