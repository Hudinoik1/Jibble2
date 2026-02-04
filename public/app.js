const form = document.getElementById("report-form");
const results = document.getElementById("results");
const errorBox = document.getElementById("error");
const clearButton = document.getElementById("clear-button");
const template = document.getElementById("person-template");

const showError = (message) => {
  errorBox.textContent = message;
  errorBox.hidden = false;
};

const clearError = () => {
  errorBox.textContent = "";
  errorBox.hidden = true;
};

const setLoading = (isLoading) => {
  const button = form.querySelector("button[type='submit']");
  button.disabled = isLoading;
  button.textContent = isLoading ? "Loading..." : "Generate report";
};

const clearResults = () => {
  results.innerHTML = "";
};

const formatTotalRow = (entry) => `
  <tr>
    <td>${entry.property}</td>
    <td>${entry.timeInFormatted}</td>
    <td>${entry.timeOutFormatted}</td>
    <td>${entry.totalFormatted}</td>
  </tr>
`;

const renderReport = (report, date) => {
  const node = template.content.cloneNode(true);
  const header = node.querySelector("h2");
  const dateLabel = node.querySelector(".report-date");
  const tbody = node.querySelector(".report-body");
  const totalWorked = node.querySelector(".total-worked");
  const balance = node.querySelector(".balance");

  header.textContent = `${report.name} - Daily Work Report`;
  dateLabel.textContent = `(${date})`;

  if (!report.groupedEntries.length) {
    tbody.innerHTML = `
      <tr>
        <td class="empty" colspan="4">No records for this day</td>
      </tr>
    `;
  } else {
    tbody.innerHTML = report.groupedEntries.map(formatTotalRow).join("");
  }

  totalWorked.textContent = report.totalFormatted;
  balance.textContent = report.balanceFormatted;

  results.appendChild(node);
};

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  clearError();
  clearResults();

  const formData = new FormData(form);
  const payload = Object.fromEntries(formData.entries());

  setLoading(true);
  try {
    const response = await fetch("/api/report", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });
    const data = await response.json();
    if (!response.ok) {
      showError(data.message || "Unable to fetch data from Jibble.");
      return;
    }

    if (!data.reports.length) {
      showError("No people returned. Check your API credentials and base URL.");
      return;
    }

    data.reports.forEach((report) => renderReport(report, data.date));
  } catch (error) {
    showError(error.message || "Unexpected error while fetching data.");
  } finally {
    setLoading(false);
  }
});

clearButton.addEventListener("click", () => {
  form.reset();
  clearResults();
  clearError();
});

const dateInput = form.querySelector("input[name='date']");
if (dateInput) {
  const today = new Date();
  const isoDate = today.toISOString().slice(0, 10);
  dateInput.value = isoDate;
}
