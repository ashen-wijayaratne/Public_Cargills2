import os
import json
import tempfile
import time
from datetime import datetime
import pytz
import gspread
import requests
from oauth2client.service_account import ServiceAccountCredentials
from googleapiclient.discovery import build
from selenium import webdriver
from selenium.webdriver.chrome.service import Service
from selenium.webdriver.chrome.options import Options
from webdriver_manager.chrome import ChromeDriverManager

# ==== SETUP GOOGLE SHEETS ====
SCOPE = ["https://spreadsheets.google.com/feeds", "https://www.googleapis.com/auth/drive"]
credentials_json = os.getenv("GOOGLE_CREDENTIALS")
if credentials_json is None:
    raise Exception("GOOGLE_CREDENTIALS secret not found")

with tempfile.NamedTemporaryFile(delete=False) as temp_creds:
    temp_creds.write(credentials_json.encode())
    temp_creds_path = temp_creds.name

creds = ServiceAccountCredentials.from_json_keyfile_name(temp_creds_path, SCOPE)
client = gspread.authorize(creds)

import atexit
@atexit.register
def cleanup():
    os.remove(temp_creds_path)

sheet = client.open("Cargills2")
live_sheet = sheet.worksheet("Live Prices")
history_sheet = sheet.worksheet("Price History")

# ==== TIMESTAMP ====
timestamp = datetime.now(pytz.timezone("Asia/Colombo")).strftime("%Y-%m-%d %H:%M:%S")

# ==== GET DYNAMIC COOKIES USING SELENIUM ====
def get_dynamic_cookies():
    try:
        options = Options()
        options.add_argument('--headless')
        options.add_argument('--disable-gpu')
        options.add_argument('--no-sandbox')
        driver = webdriver.Chrome(service=Service(ChromeDriverManager().install()), options=options)

        url = "https://cargillsonline.com/Product/Vegetables?IC=MjM=&NC=VmVnZXRhYmxlcw=="
        driver.get(url)
        time.sleep(5)

        selenium_cookies = driver.get_cookies()
        driver.quit()

        cookie_dict = {cookie['name']: cookie['value'] for cookie in selenium_cookies}
        return cookie_dict
    except Exception as e:
        print(f"[ERROR] Failed to get dynamic cookies: {e}")
        return {}

# ==== SCRAPE VEGETABLE PRICES ====
def scrape_vegetable_prices():
    print("[INFO] Scraping vegetable prices...")
    cookies = get_dynamic_cookies()
    if not cookies:
        print("[ERROR] Could not get fresh cookies. Aborting scrape.")
        return []

    session = requests.Session()
    session.headers.update({
        "User-Agent": "Mozilla/5.0",
        "Accept": "application/json",
        "Origin": "https://cargillsonline.com",
        "Referer": "https://cargillsonline.com/Product/Vegetables?IC=MjM=&NC=VmVnZXRhYmxlcw==",
        "X-Requested-With": "XMLHttpRequest",
        "Content-Type": "application/json;charset=UTF-8"
    })

    for name, value in cookies.items():
        session.cookies.set(name, value)

    payload = {
        "BannerId": "",
        "CategoryId": "MjM=",
        "CollectionId": "",
        "DataType": "",
        "Filter": "",
        "PageIndex": 1,
        "PageSize": 10000,
        "PromoId": "",
        "Search": "",
        "SectionId": "",
        "SectionType": "",
        "SubCatId": "-1"
    }

    try:
        response = session.post("https://cargillsonline.com/Web/GetMenuCategoryItemsPagingV3/", json=payload)
        response.raise_for_status()
        data = response.json()
        print(json.dumps(data[0], indent=2))
    except Exception as e:
        print(f"[ERROR] Request failed: {e}")
        return []

    vegetables = []
    for item in data:
        try:
            name = item.get("ItemName")
            price = item.get("Price")
            unit_size = item.get("UnitSize")
            uom = item.get("UOM")

            if unit_size and uom:
                name = f"{name} ({unit_size} {uom})"
            elif uom:
                name = f"{name} ({uom})"

            if name and price is not None:
                price = float(str(price).replace(",", ""))
                price_per_kg = None

                if uom and "g" in uom.lower():
                    try:
                        grams = float(unit_size)
                        if grams > 0:
                            price_per_kg = round((price / grams) * 1000, 2)
                    except:
                        pass

                vegetables.append({
                    "name": name,
                    "price": price,
                    "price_per_kg": price_per_kg
                })
        except Exception as e:
            print(f"[WARNING] Skipped item due to error: {e}")

    print(f"[INFO] Retrieved {len(vegetables)} vegetables.")
    return vegetables

# ==== UPDATE LIVE PRICES ====
def update_prices():
    vegetables = scrape_vegetable_prices()
    if not vegetables:
        print("[ERROR] No vegetables retrieved. Exiting.")
        return

    sheet_data = live_sheet.get_all_values()
    if not sheet_data:
        headers = ["Vegetable", "Current Price", "Price per Kg", timestamp]
        rows = [
            [veg["name"], veg["price"], veg.get("price_per_kg", ""), veg["price"]]
            for veg in vegetables
        ]
        live_sheet.update([headers] + rows, value_input_option="USER_ENTERED")
        return

    headers = sheet_data[0]
    data_rows = sheet_data[1:]
    veg_index = {row[0]: i for i, row in enumerate(data_rows)}

    # Add new timestamp column
    if timestamp not in headers:
        headers.append(timestamp)
    new_col_index = headers.index(timestamp)

    # Ensure "Current Price" column exists
    if "Current Price" not in headers:
        headers.insert(1, "Current Price")
        for row in data_rows:
            row.insert(1, "")
    current_price_col = headers.index("Current Price")

    # Ensure "Price per Kg" column exists
    if "Price per Kg" not in headers:
        headers.insert(current_price_col + 1, "Price per Kg")
        for row in data_rows:
            row.insert(current_price_col + 1, "")
    price_per_kg_col = headers.index("Price per Kg")

    for veg in vegetables:
        name = veg["name"]
        new_price = veg["price"]
        new_ppkg = veg.get("price_per_kg", "")

        if name in veg_index:
            row_idx = veg_index[name]
            row = data_rows[row_idx]
            while len(row) < len(headers):
                row.append("")
            row[new_col_index] = new_price
            row[current_price_col] = new_price
            row[price_per_kg_col] = new_ppkg
        else:
            new_row = [""] * len(headers)
            new_row[0] = name
            new_row[current_price_col] = new_price
            new_row[price_per_kg_col] = new_ppkg
            new_row[new_col_index] = new_price
            data_rows.append(new_row)

    updated_sheet = [headers] + data_rows
    live_sheet.update(updated_sheet, value_input_option='USER_ENTERED')
    print("[SUCCESS] Sheet updated with Current Price and Price per Kg.")

# ==== MAIN ENTRY POINT ====
if __name__ == "__main__":
    print("[START] Updating vegetable prices...")
    update_prices()
    print("[DONE] All tasks completed.")