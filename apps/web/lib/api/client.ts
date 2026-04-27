export const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL!;

export type Recommendation = {
  track_id: string;
  track_name: string | null;
  artists: string | null;
  genre: string | null;
  popularity: number;
  score: number;
  source: string;
};

export type RecommenderResponse = {
  user_id: string;
  has_data: boolean;
  coverage: {
    total_interactions: number;
    matched_interactions: number;
    total_unique_tracks: number;
    matched_unique_tracks: number;
    match_rate: number;
  };
  recommendations: Recommendation[];
};

export type ProfileSearchResult = {
  id: string;
  username: string;
  display_name: string | null;
  avatar_url: string | null;
};

export type ProfileSearchResponse = {
  results: ProfileSearchResult[];
};

export type Snapshot = {
  id: string;
  name: string | null;
  created_at: string;
  status: string;
  is_active: boolean;
};

export type RankedMetric = {
  name: string;
  streams: number;
  total_ms_played: number;
};

export type Metrics = {
  total_streams: number;
  total_ms_played: number;
  unique_tracks: number;
  unique_artists: number;
  top_track: string | null;
  top_artist: string | null;
  top_tracks?: RankedMetric[];
  top_artists?: RankedMetric[];
  day_ms?: number;
  night_ms?: number;
  weekday_ms?: number;
  weekend_ms?: number;
};

export type ProfileMetricsResponse = {
  has_data: boolean;
  profile: {
    id: string;
    username: string;
    display_name: string | null;
    avatar_url: string | null;
  };
  snapshot: Snapshot | null;
  metrics: Metrics | null;
};

export async function searchProfiles(
  accessToken: string,
  query: string
): Promise<ProfileSearchResponse> {
  const response = await fetch(
    `${API_BASE_URL}/profiles/search?q=${encodeURIComponent(query)}`,
    {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    }
  );

  if (!response.ok) {
    const raw = await response.text();
    throw new Error(`Failed to search profiles: ${raw}`);
  }

  return response.json();
}

export async function getProfileByUsername(
  accessToken: string,
  username: string
): Promise<ProfileMetricsResponse> {
  const response = await fetch(
    `${API_BASE_URL}/profiles/${encodeURIComponent(username)}`,
    {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    }
  );

  if (!response.ok) {
    const raw = await response.text();
    throw new Error(`Failed to load profile: ${raw}`);
  }

  return response.json();
}

export async function getRecommendations(
  accessToken: string,
  limit = 20
): Promise<RecommenderResponse> {
  const response = await fetch(`${API_BASE_URL}/recommender/me?limit=${limit}`, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  });

  const raw = await response.text();

  if (!response.ok) {
    console.error("Recommender API error:", raw);
    throw new Error(`Failed to fetch recommendations: ${raw}`);
  }

  return JSON.parse(raw);
}

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

export async function getRecommenderDebug(accessToken: string) {
  const response = await fetch(`${API_BASE_URL}/recommender/debug`, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  });

  if (!response.ok) {
    throw new Error(`Debug request failed: ${response.status}`);
  }

  return response.json();
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

export async function getSnapshotMetrics(accessToken: string, snapshotId: string) {
  const response = await fetch(`${API_BASE_URL}/metrics/snapshot/${snapshotId}`, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  });

  const data = await response.json();

  if (!response.ok) {
    throw new Error(data.detail || "Failed to fetch snapshot metrics.");
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