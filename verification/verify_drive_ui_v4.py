from playwright.sync_api import sync_playwright
import time

def run():
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        context = browser.new_context(viewport={'width': 1280, 'height': 800})
        page = context.new_page()

        page.on("console", lambda msg: print(f"BROWSER CONSOLE: {msg.text}"))
        page.on("pageerror", lambda exc: print(f"BROWSER ERROR: {exc}"))

        print("Opening base URL...")
        page.goto("http://localhost:3000/")
        page.wait_for_load_state("networkidle")

        # Check if root element has content
        content = page.content()
        print(f"Page content length: {len(content)}")

        browser.close()

if __name__ == "__main__":
    run()
