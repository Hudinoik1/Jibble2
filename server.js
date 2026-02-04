const express = require("express");
const path = require("path");

const app = express();
const port = process.env.PORT || 3000;

app.use(express.json({ limit: "1mb" }));
app.use(express.static(path.join(__dirname, "public")));

const DEFAULT_SHIFT_HOURS = 8;

const normalizeBaseUrl = (value) => {
  if (!value) {
    return "https://api.jibble.io";
  }
  let normalized = value.trim();
  if (!/^https?:\/\//i.test(normalized)) {
    normalized = `https://${normalized}`;
  }
  return normalized.replace(/\/$/, "");
};

const buildBaseUrlCandidates = (value) => {
  const normalized = normalizeBaseUrl(value);
  const candidates = new Set([
    normalized,
    "https://api.jibble.io",
    "https://api.jibble.io/v2",
    "https://api.jibble.io/v1",
  ]);
  if (normalized.endsWith("/v1") || normalized.endsWith("/v2")) {
    candidates.add(normalized.replace(/\/(v1|v2)$/i, ""));
  } else {
    candidates.add(`${normalized}/v2`);
    candidates.add(`${normalized}/v1`);
  }
  return Array.from(candidates);
};

const buildAuthHeaders = (id, secret) => {
  const token = Buffer.from(`${id}:${secret}`).toString("base64");
  return [
    { Authorization: `Basic ${token}` },
    { Authorization: `Bearer ${secret}` },
    { "X-API-KEY": secret },
    { "X-API-KEY": id, "X-API-SECRET": secret },
  ];
};

const sanitizeErrorMessage = (value) => {
  if (!value) {
    return "";
  }
  const withoutTags = value.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
  return withoutTags.slice(0, 280);
    return "https://api.jibble.io/v2";
  }
  return value.replace(/\/$/, "");
};

const buildAuthHeader = (id, secret) => {
  const token = Buffer.from(`${id}:${secret}`).toString("base64");
  return `Basic ${token}`;
};

const fetchJson = async (url, options) => {
  const response = await fetch(url, options);
  const text = await response.text();
  let json;
  try {
    json = text ? JSON.parse(text) : null;
  } catch (error) {
    json = null;
  }
  if (!response.ok) {
    const rawMessage = json?.message || json?.error || text || response.statusText;
    const message = sanitizeErrorMessage(rawMessage);
    const message = json?.message || json?.error || text || response.statusText;
    const err = new Error(message);
    err.status = response.status;
    err.body = json;
    throw err;
  }
  return json;
};

const extractArray = (payload) => {
  if (Array.isArray(payload)) {
    return payload;
  }
  if (!payload || typeof payload !== "object") {
    return [];
  }
  return (
    payload.data ||
    payload.people ||
    payload.persons ||
    payload.results ||
    payload.items ||
    []
  );
};

const tryEndpoints = async ({ baseUrl, authHeaders, endpoints, params = {} }) => {
const tryEndpoints = async ({ baseUrl, authHeader, endpoints, params = {} }) => {
  const query = new URLSearchParams(params);
  let lastError = null;
  for (const endpoint of endpoints) {
    const url = `${baseUrl}${endpoint}${query.toString() ? `?${query}` : ""}`;
    for (const headers of authHeaders) {
      try {
        const json = await fetchJson(url, {
          headers: {
            ...headers,
            Accept: "application/json",
          },
        });
        return { endpoint, json };
      } catch (error) {
        if (error.status && error.status < 500) {
          lastError = error;
          continue;
        }
        throw error;
      }
    try {
      const json = await fetchJson(url, {
        headers: {
          Authorization: authHeader,
          Accept: "application/json",
        },
      });
      return { endpoint, json };
    } catch (error) {
      if (error.status && error.status < 500) {
        lastError = error;
        continue;
      }
      throw error;
    }
  }
  throw lastError || new Error("Unable to fetch data from Jibble.");
};

const parseTime = (value) => {
  if (!value) {
    return null;
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return null;
  }
  return date;
};

const formatTime = (date) =>
  date
    ? date.toLocaleTimeString("en-GB", {
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
      })
    : "-";

const minutesBetween = (start, end) => {
  if (!start || !end) {
    return 0;
  }
  return Math.max(0, Math.round((end.getTime() - start.getTime()) / 60000));
};

const formatDuration = (minutes) => {
  const safeMinutes = Math.max(0, minutes);
  const hours = Math.floor(safeMinutes / 60);
  const mins = safeMinutes % 60;
  return `${hours}h ${mins.toString().padStart(2, "0")}m`;
};

const pickEntryLabel = (entry) =>
  entry.location_name ||
  entry.locationName ||
  entry.location ||
  entry.project_name ||
  entry.projectName ||
  entry.project ||
  entry.activity_name ||
  entry.activityName ||
  entry.activity ||
  entry.task_name ||
  entry.task ||
  entry.title ||
  "Unspecified";

const getEntryTimes = (entry) => {
  const timeIn = parseTime(
    entry.time_in || entry.timeIn || entry.start || entry.start_time || entry.started_at
  );
  const timeOut = parseTime(
    entry.time_out || entry.timeOut || entry.end || entry.end_time || entry.ended_at
  );
  return { timeIn, timeOut };
};

const groupEntries = (entries) => {
  const grouped = new Map();
  entries.forEach((entry) => {
    const label = pickEntryLabel(entry);
    const { timeIn, timeOut } = getEntryTimes(entry);
    const key = label || "Unspecified";
    if (!grouped.has(key)) {
      grouped.set(key, {
        property: key,
        timeIn,
        timeOut,
        totalMinutes: 0,
      });
    }
    const group = grouped.get(key);
    if (!group.timeIn || (timeIn && timeIn < group.timeIn)) {
      group.timeIn = timeIn;
    }
    if (!group.timeOut || (timeOut && timeOut > group.timeOut)) {
      group.timeOut = timeOut;
    }
    group.totalMinutes += minutesBetween(timeIn, timeOut);
  });

  return Array.from(grouped.values()).map((group) => ({
    ...group,
    timeInFormatted: formatTime(group.timeIn),
    timeOutFormatted: formatTime(group.timeOut),
    totalFormatted: formatDuration(group.totalMinutes),
  }));
};

const buildReportForPerson = ({ person, entries, shiftMinutes }) => {
  const groupedEntries = groupEntries(entries);
  const totalMinutes = groupedEntries.reduce(
    (sum, entry) => sum + entry.totalMinutes,
    0
  );
  const balanceMinutes = Math.max(0, shiftMinutes - totalMinutes);

  return {
    id: person.id || person.person_id || person.uuid || person._id,
    name:
      person.name ||
      [person.first_name, person.last_name].filter(Boolean).join(" ") ||
      person.display_name ||
      "Unknown",
    groupedEntries,
    totalMinutes,
    totalFormatted: formatDuration(totalMinutes),
    balanceFormatted: formatDuration(balanceMinutes),
  };
};

app.post("/api/report", async (req, res) => {
  try {
    const { apiKeyId, apiKeySecret, baseUrl, date, shiftHours } = req.body || {};
    if (!apiKeyId || !apiKeySecret) {
      return res.status(400).json({
        message:
          "Provide both the API Key ID and API Key Secret from Jibble to continue.",
      });
    }
    if (!date) {
      return res.status(400).json({ message: "Please pick a date to run the report." });
    }

    const baseUrlCandidates = buildBaseUrlCandidates(baseUrl);
    const authHeaders = buildAuthHeaders(apiKeyId, apiKeySecret);
    const normalizedBaseUrl = normalizeBaseUrl(baseUrl);
    const authHeader = buildAuthHeader(apiKeyId, apiKeySecret);
    const shiftMinutes =
      Number.isFinite(Number(shiftHours)) && Number(shiftHours) > 0
        ? Math.round(Number(shiftHours) * 60)
        : DEFAULT_SHIFT_HOURS * 60;

    let peopleResult;
    let resolvedBaseUrl;
    let baseUrlError;
    for (const candidate of baseUrlCandidates) {
      try {
        peopleResult = await tryEndpoints({
          baseUrl: candidate,
          authHeaders,
          endpoints: ["/people", "/persons", "/users"],
        });
        resolvedBaseUrl = candidate;
        baseUrlError = null;
        break;
      } catch (error) {
        baseUrlError = error;
      }
    }

    if (!peopleResult) {
      const details = baseUrlError?.message || "Unknown error";
      return res.status(502).json({
        message:
          "Unable to fetch people from Jibble. Check your base URL and API credentials.",
        details,
        triedBaseUrls: baseUrlCandidates,
      });
    }

    const peopleResult = await tryEndpoints({
      baseUrl: normalizedBaseUrl,
      authHeader,
      endpoints: ["/people", "/persons", "/users"],
    });
    const people = extractArray(peopleResult.json);

    const startDate = date;
    const endDate = date;

    const reports = [];

    for (const person of people) {
      const personId = person.id || person.person_id || person.uuid || person._id;
      if (!personId) {
        continue;
      }
      let entryPayload;
      try {
        const timeResult = await tryEndpoints({
          baseUrl: resolvedBaseUrl,
          authHeaders,
          baseUrl: normalizedBaseUrl,
          authHeader,
          endpoints: ["/time_entries", "/timesheets", "/time-entries"],
          params: {
            person_id: personId,
            start_date: startDate,
            end_date: endDate,
            date: startDate,
          },
        });
        entryPayload = timeResult.json;
      } catch (error) {
        entryPayload = [];
      }

      const entries = extractArray(entryPayload);
      reports.push(buildReportForPerson({ person, entries, shiftMinutes }));
    }

    return res.json({
      date,
      baseUrl: resolvedBaseUrl,
      baseUrl: normalizedBaseUrl,
      peopleCount: reports.length,
      reports,
    });
  } catch (error) {
    return res.status(500).json({
      message: `Unable to fetch data from Jibble: ${error.message}`,
    });
  }
});

app.get("/api/health", (_req, res) => {
  res.json({ status: "ok" });
});

app.listen(port, () => {
  console.log(`Server running on port ${port}`);
});
