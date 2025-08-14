from playwright.sync_api import sync_playwright, expect

def run(playwright):
    browser = playwright.chromium.launch(headless=True)
    page = browser.new_page()

    try:
        page.goto("http://localhost:5173/")

        connect_button = page.get_by_role("button", name="Connect")
        connect_button.click()

        expect(page.locator("text=/proactive_start_sent/")).to_be_visible(timeout=10000)

        expect(page.locator('text=/oai", data: "response.completed"/')).to_be_visible(timeout=20000)

        page.wait_for_timeout(2000)

        page.screenshot(path="../jules-scratch/verification/verification.png")

    except Exception as e:
        page.screenshot(path="../jules-scratch/verification/error.png")
        raise e

    finally:
        browser.close()

with sync_playwright() as playwright:
    run(playwright)
