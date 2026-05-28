
(() => {
    const DATA_URL = "https://docs.google.com/spreadsheets/d/1xKP59tAdxd8t_V-RUeMsjsnahzbcaQlNrzi3Hm2h0Zg/export?format=csv&gid=1909276998";
    const AUTO_REFRESH_SECONDS = 30;
    const DEFAULT_PAGE_SIZE = 12;
    const AREA_COLORS = ["#4db5ff", "#1fca8d", "#f89f45", "#b389ff", "#ff6b93", "#e6d04b", "#78e2de"];

    let refreshTimer = null;
    let inFlight = false;
    let cachedRecords = [];
    let filteredRecords = [];

    const tableState = {
        page: 1,
        pageSize: DEFAULT_PAGE_SIZE
    };

    const numberFormatter = new Intl.NumberFormat("es-CO");
    const percentFormatter = new Intl.NumberFormat("es-CO", {
        minimumFractionDigits: 1,
        maximumFractionDigits: 1
    });
    const dateFormatter = new Intl.DateTimeFormat("es-CO", {
        day: "2-digit",
        month: "2-digit",
        year: "numeric"
    });
    const dateTimeFormatter = new Intl.DateTimeFormat("es-CO", {
        day: "2-digit",
        month: "2-digit",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit"
    });

    const els = {
        startDateInput: document.getElementById("startDateInput"),
        endDateInput: document.getElementById("endDateInput"),
        filterInfo: document.getElementById("filterInfo"),
        sourceStatus: document.getElementById("sourceStatus"),
        lastUpdate: document.getElementById("lastUpdate"),
        errorBanner: document.getElementById("errorBanner"),
        periodLabel: document.getElementById("periodLabel"),
        activeCount: document.getElementById("activeCount"),
        activeSub: document.getElementById("activeSub"),
        totalRecords: document.getElementById("totalRecords"),
        totalSub: document.getElementById("totalSub"),
        avgStay: document.getElementById("avgStay"),
        avgStaySub: document.getElementById("avgStaySub"),
        effectiveness: document.getElementById("effectiveness"),
        effectivenessSub: document.getElementById("effectivenessSub"),
        attendedCount: document.getElementById("attendedCount"),
        attendedSub: document.getElementById("attendedSub"),
        notAttendedCount: document.getElementById("notAttendedCount"),
        notAttendedSub: document.getElementById("notAttendedSub"),
        peakHour: document.getElementById("peakHour"),
        peakHourSub: document.getElementById("peakHourSub"),
        areaBars: document.getElementById("areaBars"),
        hourBars: document.getElementById("hourBars"),
        dayBars: document.getElementById("dayBars"),
        statusBars: document.getElementById("statusBars"),
        stayBuckets: document.getElementById("stayBuckets"),
        tableMeta: document.getElementById("tableMeta"),
        recordsBody: document.getElementById("recordsBody"),
        tableSearchInput: document.getElementById("tableSearchInput"),
        pageSizeSelect: document.getElementById("pageSizeSelect"),
        prevPageButton: document.getElementById("prevPageButton"),
        nextPageButton: document.getElementById("nextPageButton"),
        pageIndicator: document.getElementById("pageIndicator"),
        loadingOverlay: document.getElementById("loadingOverlay"),
        loadingTitle: document.getElementById("loadingTitle"),
        loadingSubtitle: document.getElementById("loadingSubtitle")
    };

    init();

    function init() {
        const handleDateChange = () => {
            applyFiltersAndRender({ resetPage: true });
        };

        ["change", "input"].forEach((eventName) => {
            if (els.startDateInput) {
                els.startDateInput.addEventListener(eventName, handleDateChange);
            }
            if (els.endDateInput) {
                els.endDateInput.addEventListener(eventName, handleDateChange);
            }
        });

        els.tableSearchInput.addEventListener("input", () => {
            tableState.page = 1;
            renderTable(filteredRecords);
        });

        els.pageSizeSelect.addEventListener("change", () => {
            tableState.pageSize = Number(els.pageSizeSelect.value) || DEFAULT_PAGE_SIZE;
            tableState.page = 1;
            renderTable(filteredRecords);
        });

        els.prevPageButton.addEventListener("click", () => {
            if (tableState.page > 1) {
                tableState.page -= 1;
                renderTable(filteredRecords);
            }
        });

        els.nextPageButton.addEventListener("click", () => {
            const scopedTotal = getTableScopedRecords(filteredRecords).length;
            const totalPages = Math.ceil(scopedTotal / tableState.pageSize) || 1;
            if (tableState.page < totalPages) {
                tableState.page += 1;
                renderTable(filteredRecords);
            }
        });

        tableState.pageSize = Number(els.pageSizeSelect.value) || DEFAULT_PAGE_SIZE;
        updateTablePagination(0, 0);

        restartAutoRefresh();
        loadAndRender("initial");
    }

    function restartAutoRefresh() {
        if (refreshTimer) {
            clearInterval(refreshTimer);
            refreshTimer = null;
        }

        if (AUTO_REFRESH_SECONDS > 0) {
            refreshTimer = setInterval(() => {
                loadAndRender("auto");
            }, AUTO_REFRESH_SECONDS * 1000);
        }
    }

    async function loadAndRender(trigger) {
        if (inFlight) {
            return;
        }

        inFlight = true;
        setLoading(true, trigger);
        setStatus("Estado: actualizando datos...");

        try {
            const csvText = await fetchCsv(DATA_URL);
            const rawRows = parseCsv(csvText);
            if (!rawRows.length) {
                throw new Error("La fuente no devolvio filas utiles.");
            }

            const records = rawRows.map(buildRecord).filter((record) => record);
            cachedRecords = records;

            applyFiltersAndRender({ resetPage: false });
            hideError();
            setStatus("Estado: en linea");
            setUpdatedNow(trigger);
        } catch (error) {
            const message = error instanceof Error ? error.message : "Error desconocido";

            if (!cachedRecords.length) {
                applyFiltersAndRender({ resetPage: true });
            }

            showError(
                "No fue posible actualizar el CSV en este intento. " +
                "Detalle: " +
                message +
                ". Si abriste este HTML por file:// y falla CORS, ejecutalo desde localhost."
            );
            setStatus("Estado: error de carga");
        } finally {
            inFlight = false;
            setLoading(false, trigger);
        }
    }

    function applyFiltersAndRender(options = {}) {
        const resetPage = Boolean(options.resetPage);
        const range = getSelectedDateRange();

        if (range.isInvalid) {
            els.filterInfo.textContent = "Filtro invalido: la fecha final debe ser igual o posterior a la inicial.";
            els.filterInfo.classList.add("filter-warning");
            return;
        }

        els.filterInfo.classList.remove("filter-warning");

        filteredRecords = filterRecordsByDate(cachedRecords, range.startDate, range.endDate);
        if (resetPage) {
            tableState.page = 1;
        }

        renderAll(filteredRecords);
        updateFilterInfo(cachedRecords.length, filteredRecords.length, range.startDate, range.endDate);
    }

    function getSelectedDateRange() {
        const startDate = parseInputDate(els.startDateInput.value);
        const endDate = parseInputDate(els.endDateInput.value);
        const isInvalid = Boolean(startDate && endDate && endDate.getTime() < startDate.getTime());

        return {
            startDate,
            endDate,
            isInvalid
        };
    }

    function filterRecordsByDate(records, startDate, endDate) {
        if (!startDate && !endDate) {
            return [...records];
        }

        return records.filter((record) => {
            const recordDate = getRecordDateOnly(record);
            if (!recordDate) {
                return false;
            }

            if (startDate && recordDate.getTime() < startDate.getTime()) {
                return false;
            }

            if (endDate && recordDate.getTime() > endDate.getTime()) {
                return false;
            }

            return true;
        });
    }

    function getRecordDateOnly(record) {
        if (record.fechaDate) {
            return record.fechaDate;
        }

        const candidate = record.ingresoDate || record.marcaTemporal || record.salidaDate;
        if (!candidate) {
            return null;
        }

        return new Date(candidate.getFullYear(), candidate.getMonth(), candidate.getDate());
    }

    function parseInputDate(value) {
        const text = String(value || "").trim();
        const match = text.match(/^(\d{4})-(\d{2})-(\d{2})$/);
        if (!match) {
            return null;
        }

        return new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
    }

    function formatDateForInput(date) {
        return (
            String(date.getFullYear()) +
            "-" +
            String(date.getMonth() + 1).padStart(2, "0") +
            "-" +
            String(date.getDate()).padStart(2, "0")
        );
    }

    function setDateRangeInputs(startDate, endDate) {
        els.startDateInput.value = startDate ? formatDateForInput(startDate) : "";
        els.endDateInput.value = endDate ? formatDateForInput(endDate) : "";
    }

    function getTodayDateOnly() {
        const now = new Date();
        return new Date(now.getFullYear(), now.getMonth(), now.getDate());
    }

    function updateFilterInfo(totalRecords, visibleRecords, startDate, endDate) {
        if (!startDate && !endDate) {
            els.filterInfo.textContent =
                "Filtro: todas las fechas | " +
                numberFormatter.format(visibleRecords) +
                " registros visibles";
            return;
        }

        let label = "";
        if (startDate && endDate) {
            label = dateFormatter.format(startDate) + " al " + dateFormatter.format(endDate);
        } else if (startDate) {
            label = "desde " + dateFormatter.format(startDate);
        } else {
            label = "hasta " + dateFormatter.format(endDate);
        }

        els.filterInfo.textContent =
            "Filtro: " +
            label +
            " | " +
            numberFormatter.format(visibleRecords) +
            " de " +
            numberFormatter.format(totalRecords) +
            " registros";
    }

    function normalizeSearchTerm(value) {
        return String(value || "")
            .normalize("NFD")
            .replace(/[\u0300-\u036f]/g, "")
            .toLowerCase()
            .trim();
    }

    function matchesTableSearch(record, normalizedTerm) {
        if (!normalizedTerm) {
            return true;
        }

        const haystack = normalizeSearchTerm(
            [record.nombre, record.area, record.estado, record.fechaRaw, record.ingresoRaw].join(" ")
        );

        return haystack.includes(normalizedTerm);
    }

    function getTableScopedRecords(records) {
        const searchTerm = normalizeSearchTerm(els.tableSearchInput.value);
        return records.filter((record) => matchesTableSearch(record, searchTerm));
    }

    async function fetchCsv(url) {
        const separator = url.includes("?") ? "&" : "?";
        const requestUrl = url + separator + "_ts=" + Date.now();
        const response = await fetch(requestUrl, { cache: "no-store" });
        if (!response.ok) {
            throw new Error("HTTP " + response.status);
        }
        return response.text();
    }

    function parseCsv(text) {
        const rows = [];
        let row = [];
        let cell = "";
        let inQuotes = false;

        for (let i = 0; i < text.length; i += 1) {
            const char = text[i];

            if (char === '"') {
                if (inQuotes && text[i + 1] === '"') {
                    cell += '"';
                    i += 1;
                } else {
                    inQuotes = !inQuotes;
                }
                continue;
            }

            if (char === "," && !inQuotes) {
                row.push(cell);
                cell = "";
                continue;
            }

            if ((char === "\n" || char === "\r") && !inQuotes) {
                if (char === "\r" && text[i + 1] === "\n") {
                    i += 1;
                }

                row.push(cell);
                if (row.some((value) => String(value).trim() !== "")) {
                    rows.push(row);
                }

                row = [];
                cell = "";
                continue;
            }

            cell += char;
        }

        row.push(cell);
        if (row.some((value) => String(value).trim() !== "")) {
            rows.push(row);
        }

        if (!rows.length) {
            return [];
        }

        const headers = rows[0].map((header) => normalizeHeader(header));
        const dataRows = [];

        for (let i = 1; i < rows.length; i += 1) {
            const current = rows[i];
            const objectRow = {};

            for (let col = 0; col < headers.length; col += 1) {
                const key = headers[col] || "col_" + col;
                objectRow[key] = (current[col] || "").trim();
            }

            dataRows.push(objectRow);
        }

        return dataRows;
    }

    function normalizeHeader(header) {
        return String(header || "")
            .normalize("NFD")
            .replace(/[\u0300-\u036f]/g, "")
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, "_")
            .replace(/^_+|_+$/g, "");
    }

    function buildRecord(row) {
        const marcaTemporalRaw = getRowValue(row, ["marca_temporal", "marca_de_tiempo", "timestamp"]) || "";
        const fechaRaw = getRowValue(row, ["fecha"]) || extractDate(marcaTemporalRaw);
        const fechaDate = parseDateStringToDate(fechaRaw);
        const ingresoRaw = getRowValue(row, ["hora_de_ingreso", "ingreso", "hora_ingreso"]) || "";
        const salidaRaw = getRowValue(row, ["hora_de_salida", "salida", "hora_salida"]) || "";

        const marcaTemporal = parseDateTimeFlexible(marcaTemporalRaw);
        const ingresoDate = combineDateAndTime(fechaRaw, ingresoRaw);
        let salidaDate = combineDateAndTime(fechaRaw, salidaRaw);

        if (ingresoDate && salidaDate && salidaDate.getTime() < ingresoDate.getTime()) {
            salidaDate = new Date(salidaDate.getTime());
            salidaDate.setDate(salidaDate.getDate() + 1);
        }

        const estanciaFromSheetMinutes = parseStayMinutes(getRowValue(row, ["estancia", "duracion", "duracion_total"]));

        return {
            marcaTemporalRaw,
            fechaRaw,
            fechaDate,
            ingresoRaw,
            salidaRaw,
            nombre: getRowValue(row, ["nombre", "visitante", "persona"]) || "Sin nombre",
            area: getRowValue(row, ["area_a_visitar", "area", "area_destino"]) || "Sin area",
            estado: (getRowValue(row, ["estado"]) || "SIN ESTADO").toUpperCase(),
            ingresoDate,
            salidaDate,
            marcaTemporal,
            estanciaFromSheetMinutes
        };
    }

    function getRowValue(row, keys) {
        for (const key of keys) {
            const value = row[key];
            if (value !== undefined && value !== null) {
                const text = String(value).trim();
                if (text) {
                    return text;
                }
            }
        }
        return "";
    }

    function parseDateTimeFlexible(value) {
        const text = String(value || "").trim();
        if (!text) {
            return null;
        }

        const match = text.match(/^(\d{1,2}\/\d{1,2}\/\d{4})\s+(\d{1,2}:\d{2}(?::\d{2})?)$/);
        if (match) {
            return combineDateAndTime(match[1], match[2]);
        }

        return null;
    }

    function combineDateAndTime(dateText, timeText) {
        const datePart = parseDatePart(dateText);
        const timePart = parseTimePart(timeText);

        if (!datePart || !timePart) {
            return null;
        }

        return new Date(
            datePart.year,
            datePart.month - 1,
            datePart.day,
            timePart.hour,
            timePart.minute,
            timePart.second,
            0
        );
    }

    function parseDatePart(value) {
        const text = String(value || "").trim();
        const match = text.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
        if (!match) {
            return null;
        }

        const day = Number(match[1]);
        const month = Number(match[2]);
        const year = Number(match[3]);
        if (!day || !month || !year) {
            return null;
        }

        return { day, month, year };
    }

    function parseDateStringToDate(value) {
        const datePart = parseDatePart(value);
        if (!datePart) {
            return null;
        }

        return new Date(datePart.year, datePart.month - 1, datePart.day);
    }

    function parseTimePart(value) {
        const text = String(value || "").trim();
        const match = text.match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?$/);
        if (!match) {
            return null;
        }

        return {
            hour: Number(match[1]),
            minute: Number(match[2]),
            second: Number(match[3] || 0)
        };
    }

    function parseLocaleNumber(value) {
        const text = String(value || "").trim().replace(/\s/g, "");
        if (!text) {
            return NaN;
        }

        const normalized = text.includes(",")
            ? text.replace(/\./g, "").replace(",", ".")
            : text;

        const numericValue = Number(normalized);
        return Number.isFinite(numericValue) ? numericValue : NaN;
    }

    function parseStayMinutes(value) {
        const text = String(value || "").trim();
        if (!text) {
            return NaN;
        }

        const durationMatch = text.match(/^(\d{1,3}):(\d{1,2})(?::(\d{1,2}))?$/);
        if (durationMatch) {
            const hours = Number(durationMatch[1]);
            const minutes = Number(durationMatch[2]);
            const seconds = Number(durationMatch[3] || 0);

            if (Number.isFinite(hours) && Number.isFinite(minutes) && Number.isFinite(seconds)) {
                return hours * 60 + minutes + seconds / 60;
            }
        }

        const estanciaDays = parseLocaleNumber(text);
        return Number.isFinite(estanciaDays) ? estanciaDays * 24 * 60 : NaN;
    }

    function extractDate(value) {
        const text = String(value || "");
        const match = text.match(/(\d{1,2}\/\d{1,2}\/\d{4})/);
        return match ? match[1] : "";
    }

    function renderAll(records) {
        renderPeriod(records);
        renderKpis(records);
        renderAreaChart(records);
        renderHourChart(records);
        renderDailyChart(records);
        renderStatusChart(records);
        renderStayBuckets(records);
        renderTable(records);
    }

    function renderPeriod(records) {
        const uniqueDates = Array.from(
            new Set(records.map((record) => record.fechaRaw).filter(Boolean))
        ).sort(compareDateStrings);

        if (!uniqueDates.length) {
            els.periodLabel.textContent = "No hay fechas validas en la fuente actual.";
            return;
        }

        if (uniqueDates.length === 1) {
            els.periodLabel.textContent = "Periodo analizado: " + uniqueDates[0];
            return;
        }

        const firstDate = uniqueDates[0];
        const lastDate = uniqueDates[uniqueDates.length - 1];
        els.periodLabel.textContent =
            "Periodo analizado: " +
            firstDate +
            " al " +
            lastDate +
            " (" +
            uniqueDates.length +
            " dias)";
    }

    function renderKpis(records) {
        const now = new Date();
        const total = records.length;
        const active = records.filter((record) => isActive(record, now)).length;

        const attended = records.filter((record) => record.estado.includes("ATENDIDO") && !record.estado.includes("NO")).length;
        const notAttended = records.filter((record) => record.estado.includes("NO ATENDIDO")).length;

        const effectiveness = total ? (attended / total) * 100 : 0;
        const peakHourData = getPeakHourData(records);

        const stayDurations = records
            .map((record) => getStayMinutes(record, now))
            .filter((minutes) => Number.isFinite(minutes) && minutes > 0);

        const avgStayMinutes = stayDurations.length
            ? stayDurations.reduce((sum, value) => sum + value, 0) / stayDurations.length
            : 0;

        els.activeCount.textContent = numberFormatter.format(active);
        els.activeSub.textContent = "Visitas en curso segun hora de salida.";

        els.totalRecords.textContent = numberFormatter.format(total);
        els.totalSub.textContent = "Filas validas procesadas desde el CSV.";

        els.avgStay.textContent = stayDurations.length ? formatMinutes(avgStayMinutes) : "Sin dato";
        els.avgStaySub.textContent =
            stayDurations.length + " visitas con duracion calculada.";

        els.effectiveness.textContent = total ? percentFormatter.format(effectiveness) + "%" : "0%";
        els.effectivenessSub.textContent =
            numberFormatter.format(notAttended) + " sin atencion de " + numberFormatter.format(total);

        els.attendedCount.textContent = numberFormatter.format(attended);
        els.attendedSub.textContent = total
            ? percentFormatter.format((attended / total) * 100) + "% del total"
            : "0% del total";

        els.notAttendedCount.textContent = numberFormatter.format(notAttended);
        els.notAttendedSub.textContent = total
            ? percentFormatter.format((notAttended / total) * 100) + "% del total"
            : "0% del total";

        els.peakHour.textContent = peakHourData.label;
        els.peakHourSub.textContent = peakHourData.count
            ? numberFormatter.format(peakHourData.count) + " ingresos en esa hora"
            : "Sin ingresos con hora valida";
    }

    function getPeakHourData(records) {
        const hourMap = new Map();
        for (const record of records) {
            if (!record.ingresoDate) {
                continue;
            }

            const hour = record.ingresoDate.getHours();
            hourMap.set(hour, (hourMap.get(hour) || 0) + 1);
        }

        let peakHour = null;
        let peakCount = 0;

        for (const [hour, count] of hourMap.entries()) {
            if (count > peakCount) {
                peakHour = hour;
                peakCount = count;
            }
        }

        if (peakHour === null) {
            return { label: "--", count: 0 };
        }

        return {
            label: String(peakHour).padStart(2, "0") + ":00",
            count: peakCount
        };
    }

    function renderAreaChart(records) {
        const counts = new Map();
        for (const record of records) {
            const area = record.area || "Sin area";
            counts.set(area, (counts.get(area) || 0) + 1);
        }

        const entries = Array.from(counts.entries()).sort((a, b) => b[1] - a[1]);
        els.areaBars.innerHTML = "";

        if (!entries.length) {
            els.areaBars.innerHTML = '<div class="empty-chart">Sin datos para construir la distribucion por area.</div>';
            return;
        }

        const total = records.length;
        entries.forEach((entry, index) => {
            const area = entry[0];
            const amount = entry[1];
            const percent = total ? (amount / total) * 100 : 0;

            const row = document.createElement("div");
            row.className = "bar-row";

            const label = document.createElement("span");
            label.className = "bar-label";
            label.textContent = area;

            const track = document.createElement("div");
            track.className = "bar-track";

            const fill = document.createElement("div");
            fill.className = "bar-fill";
            fill.style.width = percent.toFixed(1) + "%";
            fill.style.background = AREA_COLORS[index % AREA_COLORS.length];
            track.appendChild(fill);

            const value = document.createElement("span");
            value.className = "bar-value";
            value.textContent = numberFormatter.format(amount) + " | " + percentFormatter.format(percent) + "%";

            row.appendChild(label);
            row.appendChild(track);
            row.appendChild(value);
            els.areaBars.appendChild(row);
        });
    }

    function renderHourChart(records) {
        const hourMap = new Map();
        for (const record of records) {
            if (!record.ingresoDate) {
                continue;
            }
            const hour = record.ingresoDate.getHours();
            hourMap.set(hour, (hourMap.get(hour) || 0) + 1);
        }

        const entries = Array.from(hourMap.entries()).sort((a, b) => a[0] - b[0]);
        els.hourBars.innerHTML = "";

        if (!entries.length) {
            els.hourBars.innerHTML = '<div class="empty-chart">Sin horas de ingreso validas para graficar.</div>';
            return;
        }

        const maxValue = Math.max(...entries.map((entry) => entry[1]));

        entries.forEach((entry) => {
            const hour = entry[0];
            const count = entry[1];

            const col = document.createElement("div");
            col.className = "hour-column";

            const countEl = document.createElement("div");
            countEl.className = "hour-count";
            countEl.textContent = String(count);

            const pillarWrap = document.createElement("div");
            pillarWrap.className = "hour-pillar-wrap";

            const pillar = document.createElement("div");
            pillar.className = "hour-pillar";
            const heightPx = Math.max(14, Math.round((count / maxValue) * 120));
            pillar.style.height = heightPx + "px";
            pillarWrap.appendChild(pillar);

            const label = document.createElement("div");
            label.className = "hour-label";
            label.textContent = String(hour).padStart(2, "0") + ":00";

            col.appendChild(countEl);
            col.appendChild(pillarWrap);
            col.appendChild(label);
            els.hourBars.appendChild(col);
        });
    }

    function renderDailyChart(records) {
        const dateMap = new Map();
        for (const record of records) {
            const dateText = record.fechaRaw || "";
            if (!dateText) {
                continue;
            }

            dateMap.set(dateText, (dateMap.get(dateText) || 0) + 1);
        }

        const entries = Array.from(dateMap.entries()).sort((a, b) => compareDateStrings(a[0], b[0]));
        els.dayBars.innerHTML = "";

        if (!entries.length) {
            els.dayBars.innerHTML = '<div class="empty-chart">Sin fechas validas para construir el trend diario.</div>';
            return;
        }

        const maxValue = Math.max(...entries.map((entry) => entry[1]));
        const total = records.length || 1;

        entries.forEach((entry, index) => {
            const dateText = entry[0];
            const count = entry[1];
            const percent = (count / total) * 100;

            const row = document.createElement("div");
            row.className = "bar-row";

            const label = document.createElement("span");
            label.className = "bar-label";
            label.textContent = dateText;

            const track = document.createElement("div");
            track.className = "bar-track";

            const fill = document.createElement("div");
            fill.className = "bar-fill";
            fill.style.width = ((count / maxValue) * 100).toFixed(1) + "%";
            fill.style.background = AREA_COLORS[index % AREA_COLORS.length];
            track.appendChild(fill);

            const value = document.createElement("span");
            value.className = "bar-value";
            value.textContent = numberFormatter.format(count) + " | " + percentFormatter.format(percent) + "%";

            row.appendChild(label);
            row.appendChild(track);
            row.appendChild(value);
            els.dayBars.appendChild(row);
        });
    }

    function renderStatusChart(records) {
        const totals = {
            atendido: 0,
            noAtendido: 0,
            otro: 0
        };

        for (const record of records) {
            const status = String(record.estado || "").toUpperCase();
            if (status.includes("NO ATENDIDO")) {
                totals.noAtendido += 1;
            } else if (status.includes("ATENDIDO")) {
                totals.atendido += 1;
            } else {
                totals.otro += 1;
            }
        }

        const entries = [
            { label: "ATENDIDO", count: totals.atendido, color: "#1fca8d" },
            { label: "NO ATENDIDO", count: totals.noAtendido, color: "#ff5b67" },
            { label: "OTRO", count: totals.otro, color: "#f6b35d" }
        ];

        els.statusBars.innerHTML = "";
        const total = records.length;
        if (!total) {
            els.statusBars.innerHTML = '<div class="empty-chart">Sin datos para segmentar estados.</div>';
            return;
        }

        entries.forEach((entry) => {
            const row = document.createElement("div");
            row.className = "bar-row";

            const label = document.createElement("span");
            label.className = "bar-label";
            label.textContent = entry.label;

            const track = document.createElement("div");
            track.className = "bar-track";

            const fill = document.createElement("div");
            fill.className = "bar-fill";
            fill.style.width = ((entry.count / total) * 100).toFixed(1) + "%";
            fill.style.background = entry.color;
            track.appendChild(fill);

            const value = document.createElement("span");
            value.className = "bar-value";
            value.textContent = numberFormatter.format(entry.count) + " | " + percentFormatter.format((entry.count / total) * 100) + "%";

            row.appendChild(label);
            row.appendChild(track);
            row.appendChild(value);
            els.statusBars.appendChild(row);
        });
    }

    function renderStayBuckets(records) {
        const now = new Date();
        const buckets = [
            { label: "0-30 min", min: 0, max: 30, count: 0 },
            { label: "30-60 min", min: 30, max: 60, count: 0 },
            { label: "1-2 h", min: 60, max: 120, count: 0 },
            { label: "2-4 h", min: 120, max: 240, count: 0 },
            { label: "4+ h", min: 240, max: Infinity, count: 0 }
        ];

        const durations = records
            .map((record) => getStayMinutes(record, now))
            .filter((minutes) => Number.isFinite(minutes) && minutes > 0);

        for (const duration of durations) {
            for (const bucket of buckets) {
                if (duration >= bucket.min && duration < bucket.max) {
                    bucket.count += 1;
                    break;
                }
            }
        }

        els.stayBuckets.innerHTML = "";

        if (!durations.length) {
            els.stayBuckets.innerHTML = '<div class="empty-chart">Sin duraciones validas para clasificar estancia.</div>';
            return;
        }

        buckets.forEach((bucket) => {
            const card = document.createElement("div");
            card.className = "bucket-item";

            const range = document.createElement("div");
            range.className = "bucket-range";
            range.textContent = bucket.label;

            const count = document.createElement("div");
            count.className = "bucket-count";
            count.textContent = numberFormatter.format(bucket.count);

            const share = document.createElement("div");
            share.className = "bucket-share";
            share.textContent = percentFormatter.format((bucket.count / durations.length) * 100) + "%";

            card.appendChild(range);
            card.appendChild(count);
            card.appendChild(share);
            els.stayBuckets.appendChild(card);
        });
    }

    function renderTable(records) {
        const now = new Date();
        const tableRecords = getTableScopedRecords(records);
        const sorted = [...tableRecords].sort((a, b) => getRecordTime(b) - getRecordTime(a));
        const totalRows = sorted.length;
        const emptyMessage = records.length
            ? "No hay coincidencias para el filtro de tabla."
            : "No hay registros para mostrar.";

        if (!totalRows) {
            tableState.page = 1;
            els.recordsBody.innerHTML = '<tr><td colspan="6" class="empty-cell">' + emptyMessage + '</td></tr>';
            els.tableMeta.textContent = "Mostrando 0 registros";
            updateTablePagination(0, 0);
            return;
        }

        const totalPages = Math.ceil(totalRows / tableState.pageSize);
        if (tableState.page > totalPages) {
            tableState.page = totalPages;
        }

        const startIndex = (tableState.page - 1) * tableState.pageSize;
        const latest = sorted.slice(startIndex, startIndex + tableState.pageSize);

        els.recordsBody.innerHTML = "";

        if (!latest.length) {
            els.recordsBody.innerHTML = '<tr><td colspan="6" class="empty-cell">' + emptyMessage + '</td></tr>';
            els.tableMeta.textContent = "Mostrando 0 registros";
            updateTablePagination(totalRows, totalPages);
            return;
        }

        latest.forEach((record) => {
            const row = document.createElement("tr");
            const active = isActive(record, now);
            if (active) {
                row.classList.add("row-active");
            }

            const dateCell = document.createElement("td");
            dateCell.textContent = record.fechaRaw || "--";

            const inCell = document.createElement("td");
            inCell.textContent = displayTime(record.ingresoRaw, record.ingresoDate);

            const nameCell = document.createElement("td");
            nameCell.textContent = record.nombre;

            const areaCell = document.createElement("td");
            areaCell.textContent = record.area;

            const stayCell = document.createElement("td");
            if (active) {
                stayCell.textContent = "En sitio";
                stayCell.className = "stay-live";
            } else {
                const minutes = getStayMinutes(record, now);
                stayCell.textContent = Number.isFinite(minutes) && minutes > 0 ? formatMinutes(minutes) : "--";
            }

            const statusCell = document.createElement("td");
            const statusTag = document.createElement("span");
            statusTag.className = "status-badge " + getStatusClass(record.estado);
            statusTag.textContent = record.estado;
            statusCell.appendChild(statusTag);

            row.appendChild(dateCell);
            row.appendChild(inCell);
            row.appendChild(nameCell);
            row.appendChild(areaCell);
            row.appendChild(stayCell);
            row.appendChild(statusCell);
            els.recordsBody.appendChild(row);
        });

        const firstRow = startIndex + 1;
        const lastRow = startIndex + latest.length;
        els.tableMeta.textContent =
            "Mostrando " + firstRow + "-" + lastRow + " de " + totalRows + " registros";

        updateTablePagination(totalRows, totalPages);
    }

    function updateTablePagination(totalRows, totalPages) {
        const hasRows = totalRows > 0;
        const currentPage = hasRows ? tableState.page : 0;
        const safeTotalPages = hasRows ? totalPages : 0;

        els.pageIndicator.textContent = "Pagina " + currentPage + " de " + safeTotalPages;
        els.prevPageButton.disabled = !hasRows || tableState.page <= 1;
        els.nextPageButton.disabled = !hasRows || tableState.page >= safeTotalPages;
    }

    function isActive(record, now) {
        if (!record.ingresoDate) {
            return false;
        }

        if (record.ingresoDate.getTime() > now.getTime()) {
            return false;
        }

        if (!record.salidaDate) {
            return true;
        }

        return record.salidaDate.getTime() > now.getTime();
    }

    function getStayMinutes(record, now) {
        if (record.ingresoDate && record.salidaDate) {
            const diff = (record.salidaDate.getTime() - record.ingresoDate.getTime()) / 60000;
            if (diff > 0) {
                return diff;
            }
        }

        if (record.ingresoDate && !record.salidaDate) {
            const openDiff = (now.getTime() - record.ingresoDate.getTime()) / 60000;
            if (openDiff > 0) {
                return openDiff;
            }
        }

        if (Number.isFinite(record.estanciaFromSheetMinutes) && record.estanciaFromSheetMinutes > 0) {
            return record.estanciaFromSheetMinutes;
        }

        return NaN;
    }

    function formatMinutes(value) {
        const totalMinutes = Math.round(value);
        const hours = Math.floor(totalMinutes / 60);
        const minutes = totalMinutes % 60;
        return String(hours).padStart(2, "0") + ":" + String(minutes).padStart(2, "0") + " h";
    }

    function displayTime(raw, date) {
        const parsed = parseTimePart(raw);
        if (parsed) {
            return (
                String(parsed.hour).padStart(2, "0") +
                ":" +
                String(parsed.minute).padStart(2, "0") +
                ":" +
                String(parsed.second).padStart(2, "0")
            );
        }

        if (date) {
            return (
                String(date.getHours()).padStart(2, "0") +
                ":" +
                String(date.getMinutes()).padStart(2, "0") +
                ":" +
                String(date.getSeconds()).padStart(2, "0")
            );
        }

        return "--";
    }

    function getRecordTime(record) {
        const candidate = record.marcaTemporal || record.ingresoDate || record.salidaDate;
        return candidate ? candidate.getTime() : 0;
    }

    function compareDateStrings(a, b) {
        const aDate = parseDateStringToDate(a);
        const bDate = parseDateStringToDate(b);

        if (!aDate || !bDate) {
            return String(a).localeCompare(String(b));
        }

        return aDate.getTime() - bDate.getTime();
    }

    function getStatusClass(status) {
        const text = String(status || "").toUpperCase();
        if (text.includes("NO ATENDIDO")) {
            return "status-bad";
        }
        if (text.includes("ATENDIDO")) {
            return "status-ok";
        }
        return "status-neutral";
    }

    function setStatus(text) {
        if (els.sourceStatus) {
            els.sourceStatus.textContent = text;
        }
    }

    function setLoading(isLoading, trigger) {
        if (isLoading) {
            let subtitle = "Sincronizando datos mas recientes...";
            if (trigger === "initial") {
                subtitle = "Cargando primera vista del dashboard...";
            }

            els.loadingTitle.textContent = "Actualizando dashboard";
            els.loadingSubtitle.textContent = subtitle;
        }

        els.loadingOverlay.classList.toggle("show", isLoading);
        els.loadingOverlay.setAttribute("aria-hidden", isLoading ? "false" : "true");
        els.loadingOverlay.setAttribute("aria-busy", isLoading ? "true" : "false");

        const controlsToLock = [
            els.startDateInput,
            els.endDateInput,
            els.tableSearchInput,
            els.pageSizeSelect,
            els.prevPageButton,
            els.nextPageButton
        ];

        controlsToLock.forEach((control) => {
            if (control) {
                control.disabled = isLoading;
            }
        });
    }

    function setUpdatedNow(trigger) {
        const triggerText =
            trigger === "manual" ? "manual" : trigger === "auto" ? "automatica" : "inicial";
        els.lastUpdate.textContent =
            "Ultima actualizacion: " +
            dateTimeFormatter.format(new Date()) +
            " (" +
            triggerText +
            ")";
    }

    function showError(message) {
        els.errorBanner.textContent = message;
        els.errorBanner.style.display = "block";
    }

    function hideError() {
        els.errorBanner.style.display = "none";
        els.errorBanner.textContent = "";
    }
})();
