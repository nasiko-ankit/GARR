# A2A Weather Agent

An intelligent weather forecasting agent built with the A2A (Agent2Agent) SDK that provides current weather conditions and forecasts for any location worldwide.

## Features

- **Current Weather**: Get real-time weather conditions for any location
- **Weather Forecasts**: Get up to 5-day weather forecasts
- **Multiple Units**: Support for metric, imperial, and kelvin temperature units
- **Detailed Information**: Temperature, humidity, wind speed, and weather conditions
- **Mock Data**: Uses mock weather data for demonstration (easily replaceable with real API)

## Installation

1. Clone or copy this agent directory
2. Install dependencies:
   ```bash
   pip install -e .
   ```

3. Set up environment variables:
   ```bash
   export OPENAI_API_KEY="your-openai-api-key"
   ```

## Usage

### Running the Agent

```bash
# Run locally
python -m src --host localhost --port 5000

# Or using Docker
docker-compose up
```

### Available Functions

#### Get Current Weather
Get current weather conditions for any location:
- Auto-detects location and provides detailed weather information
- Includes temperature, "feels like" temperature, humidity, and wind speed
- Supports multiple temperature units (metric, imperial, kelvin)

#### Get Weather Forecast
Get weather forecasts for upcoming days:
- Provides up to 5-day forecasts
- Shows daily temperature and conditions
- Customizable forecast duration

## Examples

### Current Weather
```
"What's the weather like in New York?"
"Get me the current weather in Tokyo"
"How's the weather in London right now?"
```

### Weather Forecasts
```
"Give me a 5-day forecast for Seattle"
"What will the weather be like in Paris this week?"
"Show me the forecast for Sydney for the next 3 days"
```

## Configuration

The agent runs on port 5000 by default. You can customize the host and port using command line options:

```bash
python -m src --host 0.0.0.0 --port 8080
```

## Dependencies

- a2a-sdk: A2A framework for agent communication
- requests: HTTP client for API calls
- openai: For agent conversation handling
- pydantic: Data validation and modeling
- Standard Python libraries: asyncio, typing

## Mock Data

This implementation uses mock weather data for demonstration purposes. The mock data includes:
- New York: Partly cloudy, 22.5°C
- London: Light rain, 15.8°C  
- Tokyo: Sunny, 26.3°C
- Generic data for other locations

To use real weather data, replace the mock implementation in `weather_toolset.py` with actual API calls to services like:
- OpenWeatherMap API
- WeatherAPI
- AccuWeather API

## Environment Variables

- `OPENAI_API_KEY`: Required for OpenAI integration
- `WEATHER_API_KEY`: Add this for real weather API integration (currently uses mock data)

## Docker Support

The agent includes Docker support:

```bash
# Build and run with Docker
docker-compose up

# Or build manually
docker build -t a2a-weather-agent .
docker run -p 5000:5000 -e OPENAI_API_KEY=your-key a2a-weather-agent
```

## Customization

This agent was created from the A2A agent template. To create your own agent:

1. Copy the template: `cp -r a2a-agent-template your-agent-name`
2. Replace placeholders with your specific values
3. Implement your custom toolset functionality
4. Update dependencies and configuration as needed

## Testing

Test the agent by sending weather requests:

```bash
curl -X POST http://localhost:5000/agent/message \
     -H "Content-Type: application/json" \
     -d '{"message": "What is the weather like in New York?"}'
```

The agent will respond with current weather information formatted in a user-friendly way.