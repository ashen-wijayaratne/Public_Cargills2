/**
 * Main function to generate daily & (on Fridays) weekly market report.
 * Adapts to new sheet format and includes a table for vegetables under 200 LKR/kg.
 */
function generateMarketReport() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName("Live Prices");
  const data = sheet.getDataRange().getValues();
  const headers = data[0];
  const numRows = data.length - 1;
  const numCols = headers.length;
  const today = new Date();
  const isFriday = today.getDay() === 5;

  // Column mapping in new format
  const colVeg = 0;
  const colHistLow = 1;
  const colCurrent = 2;
  const colPricePerKg = 3;
  const colPriceStart = 4; // first timestamped column
  const prevDayCol = numCols - 2; // latest price column

  let histLowAlerts = [];
  let priceColors = [];

  let cheapVeggies = []; // For under‑200 LKR/kg

  for (let i = 1; i <= numRows; i++) {
    const row = data[i];
    const veg = row[colVeg];
    const histLow = parseFloat(row[colHistLow]);
    const currPrice = parseFloat(row[colCurrent]);
    const prevPrice = parseFloat(row[prevDayCol]);
    const perKg = parseFloat(row[colPricePerKg]);

    // Historical low alert
    if (!isNaN(histLow) && !isNaN(currPrice) && currPrice <= histLow * 1.05) {
      histLowAlerts.push({
        veg,
        currPrice: currPrice.toFixed(2),
        histLow: histLow.toFixed(2),
      });
    }

    // Price colors / discount
    if (!isNaN(currPrice)) {
      const color = !isNaN(prevPrice)
        ? currPrice < prevPrice
          ? "green"
          : currPrice > prevPrice
          ? "red"
          : "black"
        : "black";
      const discount =
        !isNaN(prevPrice) && prevPrice !== 0
          ? ((currPrice - prevPrice) / prevPrice) * 100
          : null;

      priceColors.push({ veg, price: currPrice, prevPrice, color, discount });
    }

    // Cheap veggies under 200 LKR/kg
    if (!isNaN(perKg) && perKg < 200) {
      cheapVeggies.push({ veg, perKg });
    }
  }

  // Sort cheap veggies by price ascending
  cheapVeggies.sort((a, b) => a.perKg - b.perKg);

  // Sort priceColors by discount % ascending
  priceColors.sort((a, b) => {
    if (a.discount === null) return 1;
    if (b.discount === null) return -1;
    return a.discount - b.discount;
  });

  // Start email body with header & container div
  let emailBody = `
<div style="font-family:Arial,sans-serif;padding:20px;color:#333;background:#f9f9f9;">
  <div style="border-bottom:2px solid #ecf0f1;padding-bottom:5px;">
    <h2 style="color:#2c3e50;margin:0;">Daily Cargills Vegetable Market Summary (${formatDate(
      today
    )})</h2>
    <span style="font-size:12px;color:#888;font-style:italic;">brought to you by Ashen Wijayaratne</span>
  </div>
`;

  const summaryStats = `
  <div
    style="
      background: #ffffff;
      border: 1px solid #dce3eb;
      padding: 20px 25px;
      border-radius: 8px;
      margin: 20px 0;
      font-size: 13.5px;
      color: #2c3e50;
      font-family: 'Helvetica Neue', Helvetica, Arial, sans-serif;
      box-shadow: 0 4px 12px rgba(44, 62, 80, 0.08);
      width: 100%;
      box-sizing: border-box;
      line-height: 1.5;
    "
  >
    <h3
      style="
        margin: 0 0 16px 0;
        font-weight: 600;
        font-size: 18px;
        color: #1f2a38;
        border-bottom: 2px solid #097969;
        padding-bottom: 6px;
        letter-spacing: 0.03em;
      "
    >
      Daily Market Snapshot
    </h3>

    <ul style="list-style: none; padding: 0; margin: 0;">
      <li style="padding: 6px 0; border-bottom: 1px solid #f0f3f7;">
        <strong>Total Vegetables Analyzed:</strong> ${numRows}
      </li>
      <li style="padding: 6px 0; border-bottom: 1px solid #f0f3f7;">
        <strong>Vegetable Price Drops:</strong> ${
          priceColors.filter((p) => p.discount < 0).length
        }
      </li>
      <li style="padding: 6px 0; border-bottom: 1px solid #f0f3f7;">
        <strong>Vegetable Price Increases:</strong> ${
          priceColors.filter((p) => p.discount > 0).length
        }
      </li>
      <li style="padding: 6px 0; border-bottom: 1px solid #f0f3f7;">
        <strong>Vegetable Priced Under 200 LKR/kg:</strong> ${
          cheapVeggies.length
        }
      </li>
      <li style="padding: 6px 0;">
        <strong>Near Historical Lows:</strong> ${histLowAlerts.length}
      </li>
    </ul>
  </div>
`;

  emailBody += summaryStats;

  // Historical Price Alerts section
  emailBody += `
  <h3 style="color:#097969;">Historically Low Price Alerts</h3>
  ${
    histLowAlerts.length > 0
      ? `
    <table style="width:100%;border-collapse:collapse;margin-bottom:20px;">
      <tr style="background:#ecf0f1;">
        <th style="padding:8px;border:1px solid #ddd;text-align:left;">Vegetable</th>
        <th style="padding:8px;border:1px solid #ddd;text-align:left;">Current Price</th>
        <th style="padding:8px;border:1px solid #ddd;text-align:left;">Historical Low</th>
      </tr>
      ${histLowAlerts
        .map(
          (item) => `
        <tr>
          <td style="padding:8px;border:1px solid #ddd;">${item.veg}</td>
          <td style="padding:8px;border:1px solid #ddd;">${item.currPrice}</td>
          <td style="padding:8px;border:1px solid #ddd;">${item.histLow}</td>
        </tr>
      `
        )
        .join("")}
    </table>
  `
      : `<p>No vegetables near or below historical low today.</p>`
  }
`;

  // Cheap veggies under 200 LKR/kg
  emailBody += `
  <h3 style="color:#098039;margin-top:30px;">✅ Vegetables that are under LKR 200 per kg</h3>
`;

  if (cheapVeggies.length > 0) {
    emailBody += `
    <table style="width:100%;border-collapse:collapse;">
      <tr style="background:#eafaf1;">
        <th style="padding:8px;border:1px solid #ddd;">Vegetable</th>
        <th style="padding:8px;border:1px solid #ddd;">Price per Kg (LKR)</th>
      </tr>
      ${cheapVeggies
        .map((v, index) => {
          const medal = getMedal(index);
          const isTop3 = index < 3;
          return `
          <tr>
            <td style="padding:8px;border:1px solid #ddd;">
              <div style="display:flex;justify-content:space-between;align-items:center;">
                <span>${v.veg}</span>
                <span>${medal}</span>
              </div>
            </td>
            <td style="padding:8px;border:1px solid #ddd;font-weight:${
              isTop3 ? "bold" : "normal"
            };">
              ${v.perKg.toFixed(2)}
            </td>
          </tr>
        `;
        })
        .join("")}
    </table>
  `;
  } else {
    emailBody += "<p>No vegetables under 200 LKR/kg today.</p>";
  }

  // Current prices & price drops table
  emailBody += `
  <h3 style="color:#097969;margin-top:20px;">Current Prices & Price Drops</h3>
  <table style="width:100%;border-collapse:collapse;margin-top:10px;">
    <tr style="background:#ecf0f1;">
      <th style="padding:8px;border:1px solid #ddd;text-align:left;">Vegetable</th>
      <th style="padding:8px;border:1px solid #ddd;text-align:left;">Yesterday's Price</th>
      <th style="padding:8px;border:1px solid #ddd;text-align:left;">Today's Price</th>
      <th style="padding:8px;border:1px solid #ddd;text-align:left;">Price Drop % 🔻</th>
    </tr>
`;

  priceColors.forEach((pc) => {
    const discText =
      !isNaN(pc.prevPrice) && pc.prevPrice !== 0
        ? `${(((pc.price - pc.prevPrice) / pc.prevPrice) * 100).toFixed(2)}%`
        : "N/A";
    emailBody += `
    <tr>
      <td style="padding:8px;border:1px solid #ddd;">${pc.veg}</td>
      <td style="padding:8px;border:1px solid #ddd;">${
        isNaN(pc.prevPrice) ? "N/A" : pc.prevPrice
      }</td>
      <td style="padding:8px;border:1px solid #ddd;color:${
        pc.color
      };font-weight:bold;">${pc.price}</td>
      <td style="padding:8px;border:1px solid #ddd;color:${
        pc.color
      };font-weight:bold;">${discText}</td>
    </tr>
  `;
  });

  emailBody += `</table>`;

  const footer = `
  <div style="margin-top:40px;font-size:11px;color:#888;text-align:center;line-height:1.6;">
    Prices are sourced live from the Cargills Website every morning.<br>
    <a href="https://docs.google.com/spreadsheets/d/174MkTSdnR56tgrd_qm-4zFVMhRHVPL75EHG8wCIIh-I/edit?usp=sharing" 
       style="color:#2980b9;text-decoration:none;font-size:12px;">
      📂 View Full Price Sheet
    </a>
  </div>
`;

  emailBody += footer;
  emailBody += `</div>`; // Add closing div tag for container

  Logger.log(emailBody);

  MailApp.sendEmail({
    to: "uwijayaratne@shamrockseniors.com",
    subject: "Today’s Vegetable Prices – Market Update",
    htmlBody: emailBody,
  });
}

function stdDev(arr) {
  return arr.length
    ? Math.sqrt(average(arr.map((v) => (v - average(arr)) ** 2)))
    : NaN;
}
function isDateString(str) {
  return !isNaN(Date.parse(str));
}
function formatTopMovers(arr) {
  return arr.length
    ? arr
        .slice(0, 3)
        .map((m) => `${m.veg} (${m.change.toFixed(2)}%)`)
        .join(", ")
    : "None";
}
function formatDate(d) {
  return Utilities.formatDate(d, Session.getScriptTimeZone(), "yyyy-MM-dd");
}
function getMedal(index) {
  return ["🥇", "🥈", "🥉"][index] || "";
}
