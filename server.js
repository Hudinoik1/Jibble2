const express = require("express");
const path = require("path");

const app = express();
const port = process.env.PORT || 3000;

app.use(express.json({ limit: "1mb" }));
app.use(express.static(path.join(__dirname, "public")));

const DEFAULT_SHIFT_HOURS = 8;
const DEFAULT_TIMEOUT_MS = 12000;
const DEFAULT_RETRIES = 2;

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
    "https://api.jibble.io/api/v2",
    "https://api.jibble.io/api/v1",
  ]);

  const addVariants = (base) => {
    candidates.add(base);
    candidates.add(`${base}/v2`);
    candidates.add(`${base}/v1`);
    candidates.add(`${base}/api/v2`);
    candidates.add(`${base}/api/v1`);
  };

  if (normalized.endsWith("/v1") || normalized.endsWith("/v2")) {
    addVariants(normalized.replace(/\/(v1|v2)$/i, ""));
  } else if (normalized.includes("/api/v")) {
    addVariants(normalized.replace(/\/api\/v\d$/i, ""));
  } else {
    addVariants(normalized);
  }

  return Array.from(candidates).filter(Boolean);
};

const buildAuthStrategies = (mode, id, secret) => {
  const token = Buffer.from(`${id}:${secret}`).toString("base64");
  const strategies = [
    {
      key: "basic",
      label: "Basic (ID:Secret)",
      headers: { Authorization: `Basic ${token}` },
    },
    {
      key: "bearer",
      label: "Bearer (Secret)",
      headers: { Authorization: `Bearer ${secret}` },
    },
    {
      key: "api-key",
      label: "X-API-KEY (Secret)",
      headers: { "X-API-KEY": secret },
    },
    {
      key: "api-key-id",
      label: "X-API-KEY + X-API-SECRET",
      headers: { "X-API-KEY": id, "X-API-SECRET": secret },
    },
  ];

  if (!mode || mode === "auto") {
    return strategies;
  }

  const selected = strategies.find((strategy) => strategy.key === mode);
  return selected ? [selected] : strategies;
};

const sanitizeErrorMessage = (value) => {
  if (!value) {
    return "";
  }
  const withoutTags = value.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
  return withoutTags.slice(0, 300);
};

const fetchWithTimeout = async (url, options, timeoutMs) => {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timeoutId);
  }
};

const fetchJson = async (url, options, retries, timeoutMs) => {
  let attempt = 0;
  let lastError;
  while (attempt <= retries) {
    try {
      const response = await fetchWithTimeout(url, options, timeoutMs);
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
        const err = new Error(message || `HTTP ${response.status}`);
        err.status = response.status;
        err.body = json;
        throw err;
      }

      return json;
    } catch (error) {
      lastError = error;
      if (error.name === "AbortError") {
        lastError = new Error("Request timed out.");
      }
      if (attempt >= retries) {
        break;
      }
      if (error.status && error.status < 500) {
        break;
      }
      const delay = 300 * (attempt + 1);
      await new Promise((resolve) => setTimeout(resolve, delay));
      attempt += 1;
    }
  }
  throw lastError;
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

const tryEndpoints = async ({
  baseUrl,
  authStrategies,
  endpoints,
  params = {},
  retries,
  timeoutMs,
}) => {
  const query = new URLSearchParams(params);
  let lastError = null;
  for (const endpoint of endpoints) {
    const url = `${baseUrl}${endpoint}${query.toString() ? `?${query}` : ""}`;
    for (const strategy of authStrategies) {
      try {
        const json = await fetchJson(
          url,
          {
            headers: {
              ...strategy.headers,
              Accept: "application/json",
            },
          },
          retries,
          timeoutMs
        );
        return { endpoint, json, authStrategy: strategy.label };
      } catch (error) {
        if (error.status && error.status < 500) {
          lastError = error;
          continue;
        }
        lastError = error;
      }
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

const buildTimeEntryParamSets = (personId, date) => [
  { person_id: personId, start_date: date, end_date: date },
  { person_id: personId, date },
  { person_id: personId, from: date, to: date },
  { person_id: personId, start: date, end: date },
];

app.post("/api/report", async (req, res) => {
  try {
    const {
      apiKeyId,
      apiKeySecret,
      baseUrl,
      date,
      shiftHours,
      authMode,
      timeoutMs,
    } = req.body || {};

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
    const authStrategies = buildAuthStrategies(authMode, apiKeyId, apiKeySecret);
    const shiftMinutes =
      Number.isFinite(Number(shiftHours)) && Number(shiftHours) > 0
        ? Math.round(Number(shiftHours) * 60)
        : DEFAULT_SHIFT_HOURS * 60;
    const retries = DEFAULT_RETRIES;
    const timeout =
      Number.isFinite(Number(timeoutMs)) && Number(timeoutMs) > 0
        ? Math.round(Number(timeoutMs))
        : DEFAULT_TIMEOUT_MS;

    let peopleResult;
    let resolvedBaseUrl;
    let resolvedAuth;
    let resolvedPeopleEndpoint;
    let baseUrlError;

    for (const candidate of baseUrlCandidates) {
      try {
        const result = await tryEndpoints({
          baseUrl: candidate,
          authStrategies,
          endpoints: ["/people", "/users", "/persons", "/members", "/staff"],
          retries,
          timeoutMs: timeout,
        });
        peopleResult = result.json;
        resolvedBaseUrl = candidate;
        resolvedAuth = result.authStrategy;
        resolvedPeopleEndpoint = result.endpoint;
        baseUrlError = null;
        break;
      } catch (error) {
        baseUrlError = error;
      }
    }

    if (!peopleResult) {
      const details = sanitizeErrorMessage(baseUrlError?.message || "Unknown error");
      return res.status(502).json({
        message:
          "Unable to fetch people from Jibble. Check your base URL and API credentials.",
        details,
        triedBaseUrls: baseUrlCandidates,
      });
    }

    const people = extractArray(peopleResult);
    const reports = [];
    let entriesEndpointUsed = null;

    for (const person of people) {
      const personId = person.id || person.person_id || person.uuid || person._id;
      if (!personId) {
        continue;
      }

      let entryPayload = [];
      const paramSets = buildTimeEntryParamSets(personId, date);

      for (const params of paramSets) {
        try {
          const result = await tryEndpoints({
            baseUrl: resolvedBaseUrl,
            authStrategies,
            endpoints: ["/time_entries", "/time-entries", "/timesheets", "/entries"],
            params,
            retries,
            timeoutMs: timeout,
          });
          entryPayload = result.json;
          entriesEndpointUsed = result.endpoint;
          break;
        } catch (error) {
          entryPayload = [];
        }
      }

      const entries = extractArray(entryPayload);
      reports.push(buildReportForPerson({ person, entries, shiftMinutes }));
    }

    return res.json({
      date,
      baseUrl: resolvedBaseUrl,
      authStrategy: resolvedAuth,
      peopleEndpoint: resolvedPeopleEndpoint,
      entriesEndpoint: entriesEndpointUsed,
      peopleCount: reports.length,
      reports,
    });
  } catch (error) {
    return res.status(500).json({
      message: `Unable to fetch data from Jibble: ${sanitizeErrorMessage(error.message)}`,
    });
  }
});

app.get("/api/health", (_req, res) => {
  res.json({ status: "ok" });
});

app.listen(port, () => {
  console.log(`Server running on port ${port}`);
});
