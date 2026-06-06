import logging
import os

import click
import uvicorn

from a2a.server.apps import A2AStarletteApplication
from a2a.server.request_handlers import DefaultRequestHandler
from a2a.server.tasks import InMemoryTaskStore
from a2a.types import (
    AgentCapabilities,
    AgentCard,
    AgentSkill,
)
from dotenv import load_dotenv
from openai_agent import create_agent  # type: ignore[import-not-found]
from openai_agent_executor import (
    OpenAIAgentExecutor,  # type: ignore[import-untyped]
)
from starlette.applications import Starlette
from starlette.middleware.cors import CORSMiddleware


load_dotenv()

logging.basicConfig()


@click.command()
@click.option('--host', 'host', default='localhost')
@click.option('--port', 'port', default=5000)
def main(host: str, port: int):
    # Resolve LLM credentials — prefer OpenRouter, fall back to OpenAI
    base_url = None
    model = 'gpt-4o'

    if os.getenv('OPENROUTER_API_KEY'):
        api_key = os.getenv('OPENROUTER_API_KEY')
        base_url = 'https://openrouter.ai/api/v1'
        model = os.getenv('OPENROUTER_MODEL', 'nvidia/nemotron-3-super-120b-a12b:free')
    else:
        api_key = os.getenv('OPENAI_API_KEY')

    if not api_key:
        raise ValueError('Set OPENROUTER_API_KEY (recommended) or OPENAI_API_KEY')

    skill = AgentSkill(
        id='weather_forecasting',
        name='Weather Forecasting',
        description='Get weather information and forecasts for any location',
        tags=['weather', 'forecast', 'temperature', 'humidity', 'conditions'],
        examples=[
            "What's the weather like in New York?",
            "Give me a 5-day forecast for London",
            "Is it going to rain tomorrow in Seattle?",
            "What's the temperature in Tokyo right now?",
        ],
    )

    agent_card = AgentCard(
        name='Weather Agent',
        description='An intelligent weather forecasting agent that provides current weather conditions and forecasts',
        url=f'http://{host}:{port}/',
        version='1.0.0',
        default_input_modes=['text'],
        default_output_modes=['text'],
        capabilities=AgentCapabilities(streaming=True),
        skills=[skill],
    )

    agent_data = create_agent()

    agent_executor = OpenAIAgentExecutor(
        card=agent_card,
        tools=agent_data['tools'],
        api_key=api_key,
        system_prompt=agent_data['system_prompt'],
        base_url=base_url,
        model=model,
    )

    request_handler = DefaultRequestHandler(
        agent_executor=agent_executor, task_store=InMemoryTaskStore()
    )

    a2a_app = A2AStarletteApplication(
        agent_card=agent_card, http_handler=request_handler
    )
    routes = a2a_app.routes()

    app = Starlette(routes=routes)
    app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])

    uvicorn.run(app, host=host, port=port)


if __name__ == '__main__':
    main()