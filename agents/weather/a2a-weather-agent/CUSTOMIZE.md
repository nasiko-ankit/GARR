# Agent Template Customization Guide

This guide walks you through customizing the A2A agent template for your specific use case.

## Manual Customization Checklist

If you prefer to customize manually, follow this checklist:

### 1. Basic Information
- [ ] Replace `{{AGENT_NAME}}` with your agent name
- [ ] Replace `{{AGENT_DESCRIPTION}}` with your agent description
- [ ] Replace `{{AGENT_CONTAINER_NAME}}` with your container name (port is fixed at 5000)

### 2. Skills & Capabilities
- [ ] Replace `{{AGENT_SKILL_ID}}` with unique skill ID
- [ ] Replace `{{AGENT_SKILL_NAME}}` with human-readable skill name
- [ ] Replace `{{AGENT_SKILL_DESCRIPTION}}` with skill description
- [ ] Replace `{{AGENT_TAGS}}` with array of relevant tags
- [ ] Replace `{{AGENT_EXAMPLES}}` with array of usage examples

### 3. Toolset Configuration
- [ ] Replace `{{TOOLSET_CLASS}}` with your toolset class name
- [ ] Replace `{{TOOLSET_MODULE}}` with your toolset module name
- [ ] Replace `{{TOOLSET_DESCRIPTION}}` with toolset description
- [ ] Rename `src/agent_toolset.py` to your module name

### 4. Implementation
- [ ] Update `{{SYSTEM_PROMPT}}` with your agent's system prompt
- [ ] Implement actual functions in your toolset
- [ ] Add required dependencies to pyproject.toml
- [ ] Update Dockerfile with additional dependencies
- [ ] Set up environment variables

### 5. Testing
- [ ] Test locally with `python -m src`
- [ ] Test Docker build and run
- [ ] Verify all functions work as expected

## Example Replacements

Here are example replacements for a weather agent:

```
{{AGENT_NAME}} → "a2a-weather-agent"
{{AGENT_DESCRIPTION}} → "An intelligent weather forecasting agent"
{{AGENT_CONTAINER_NAME}} → "a2a-weather"
# Port is fixed at 5000 for all agents
{{AGENT_SKILL_ID}} → "weather_forecasting"
{{AGENT_SKILL_NAME}} → "Weather Forecasting"
{{AGENT_SKILL_DESCRIPTION}} → "Get weather information and forecasts"
{{AGENT_TAGS}} → ['weather', 'forecast', 'temperature', 'humidity']
{{AGENT_EXAMPLES}} → [
    "What's the weather like in New York?",
    "Give me a 5-day forecast for London",
    "Is it going to rain tomorrow in Seattle?"
]
{{TOOLSET_CLASS}} → "WeatherToolset"
{{TOOLSET_MODULE}} → "weather_toolset"
{{TOOLSET_DESCRIPTION}} → "Weather information and forecasting toolset"
{{SYSTEM_PROMPT}} → "You are a Weather Agent that helps users get current weather conditions and forecasts..."
```

## Tips

1. **Consistent Naming:** Use consistent naming patterns across all placeholders
2. **Clear Descriptions:** Make descriptions clear and specific to your agent's purpose
3. **Relevant Examples:** Provide examples that showcase your agent's main capabilities
4. **Port Management:** All agents use port 5000 internally; external routing is handled by the platform
5. **Environment Variables:** Plan your environment variables early in the customization process