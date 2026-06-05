import requests
import asyncio
from typing import Any
from pydantic import BaseModel


class WeatherRequest(BaseModel):
    """Request model for weather information"""
    location: str
    units: str = "metric"  # metric, imperial, or kelvin


class ForecastRequest(BaseModel):
    """Request model for weather forecast"""
    location: str
    days: int = 5
    units: str = "metric"


class WeatherResponse(BaseModel):
    """Weather response model"""
    location: str
    temperature: float
    feels_like: float
    humidity: int
    description: str
    wind_speed: float
    status: str


class WeatherToolset:
    """Weather information and forecasting toolset"""

    def __init__(self):
        # Using OpenWeatherMap API (free tier)
        # In a real implementation, you'd get this from environment variables
        self.api_key = "demo_key"  # Replace with actual API key
        self.base_url = "https://api.openweathermap.org/data/2.5"
        self.session = requests.Session()

    def _get_weather_data(self, location: str, units: str = "metric") -> dict:
        """Get weather data from OpenWeatherMap API (mock implementation)"""
        # This is a mock implementation since we don't have a real API key
        # In a real implementation, you would make actual API calls
        mock_data = {
            "new york": {
                "name": "New York",
                "main": {
                    "temp": 22.5,
                    "feels_like": 24.1,
                    "humidity": 65
                },
                "weather": [{"description": "partly cloudy"}],
                "wind": {"speed": 3.2}
            },
            "london": {
                "name": "London", 
                "main": {
                    "temp": 15.8,
                    "feels_like": 14.2,
                    "humidity": 78
                },
                "weather": [{"description": "light rain"}],
                "wind": {"speed": 2.8}
            },
            "tokyo": {
                "name": "Tokyo",
                "main": {
                    "temp": 26.3,
                    "feels_like": 28.7,
                    "humidity": 71
                },
                "weather": [{"description": "sunny"}],
                "wind": {"speed": 1.5}
            }
        }
        
        location_key = location.lower().strip()
        if location_key in mock_data:
            return mock_data[location_key]
        else:
            # Return generic data for unknown locations
            return {
                "name": location.title(),
                "main": {
                    "temp": 20.0,
                    "feels_like": 22.0,
                    "humidity": 60
                },
                "weather": [{"description": "clear sky"}],
                "wind": {"speed": 2.0}
            }

    async def get_weather(
        self, 
        location: str, 
        units: str = "metric"
    ) -> str:
        """Get current weather for a specific location
        
        Args:
            location: The city/location to get weather for
            units: Temperature units (metric, imperial, or kelvin)
            
        Returns:
            str: Current weather information
        """
        try:
            if not location.strip():
                return "Error: Please provide a location"
            
            # Simulate API call with mock data
            await asyncio.sleep(0.1)  # Simulate network delay
            weather_data = self._get_weather_data(location, units)
            
            # Format the response
            temp_unit = "°C" if units == "metric" else "°F" if units == "imperial" else "K"
            wind_unit = "m/s" if units == "metric" else "mph"
            
            result = f"""Current weather in {weather_data['name']}:
Temperature: {weather_data['main']['temp']}{temp_unit} (feels like {weather_data['main']['feels_like']}{temp_unit})
Conditions: {weather_data['weather'][0]['description'].title()}
Humidity: {weather_data['main']['humidity']}%
Wind Speed: {weather_data['wind']['speed']} {wind_unit}"""
            
            return result
            
        except Exception as e:
            return f"Error getting weather data: {str(e)}"

    async def get_forecast(
        self, 
        location: str, 
        days: int = 5,
        units: str = "metric"
    ) -> str:
        """Get weather forecast for a specific location
        
        Args:
            location: The city/location to get forecast for
            days: Number of days to forecast (1-5)
            units: Temperature units (metric, imperial, or kelvin)
            
        Returns:
            str: Weather forecast information
        """
        try:
            if not location.strip():
                return "Error: Please provide a location"
                
            if days < 1 or days > 5:
                return "Error: Forecast days must be between 1 and 5"
            
            # Simulate API call
            await asyncio.sleep(0.1)
            base_data = self._get_weather_data(location, units)
            
            temp_unit = "°C" if units == "metric" else "°F" if units == "imperial" else "K"
            
            # Generate mock forecast data
            forecast_conditions = ["sunny", "partly cloudy", "cloudy", "light rain", "clear"]
            result = f"{days}-day weather forecast for {base_data['name']}:\n\n"
            
            base_temp = base_data['main']['temp']
            for i in range(days):
                # Simulate temperature variation
                temp_variation = (i - 2) * 2  # Temperature varies by ±4 degrees
                day_temp = base_temp + temp_variation
                condition = forecast_conditions[i % len(forecast_conditions)]
                
                result += f"Day {i+1}: {day_temp}{temp_unit} - {condition.title()}\n"
            
            return result.strip()
            
        except Exception as e:
            return f"Error getting forecast data: {str(e)}"

    def get_tools(self) -> dict[str, Any]:
        """Return dictionary of available tools for OpenAI function calling"""
        return {
            'get_weather': self,
            'get_forecast': self,
        }