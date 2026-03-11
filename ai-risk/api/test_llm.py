import os
from dotenv import load_dotenv
from openai import OpenAI

load_dotenv(".env")

api_key = os.getenv("OPENAI_API_KEY")
print("OPENAI_API_KEY loaded:", "YES" if api_key else "NO")

if not api_key:
    raise RuntimeError("OPENAI_API_KEY not found in api/.env")

client = OpenAI(api_key=api_key)

response = client.chat.completions.create(
    model="gpt-4o-mini",
    messages=[
        {"role": "system", "content": "You are a helpful assistant."},
        {"role": "user", "content": "Explain what gas is in Ethereum in one short paragraph."}
    ],
)

print("\n=== LLM RESPONSE ===\n")
print(response.choices[0].message.content)