# Understanding Routes vs Rewrites in Vercel Configuration

When deploying to Vercel, it's important to understand the difference between `routes` and `rewrites`, as they cannot be used together in the same configuration file.

## Vercel Configuration Limitation

According to Vercel's documentation:

> **Mixed routing properties**
> 
> If you have rewrites, redirects, headers, cleanUrls or trailingSlash defined in your configuration file, then `routes` cannot be defined.
> 
> This is a necessary limitation because routes is a lower-level primitive that contains all of the other types. Therefore, it cannot be merged safely with the new properties.

## Using Rewrites (Recommended)

Rewrites are the modern approach and generally preferred for most use cases. They maintain the original URL while fetching content from a different location.

```json
{
  "rewrites": [
    { "source": "/api/(.*)", "destination": "/api/index.js" },
    { "source": "/(.*)", "destination": "/index.html" }
  ]
}
```

Benefits of rewrites:
- They're more intuitive
- The URL in the browser stays the same (users see the original path)
- They work well with Single Page Applications (SPAs)

## Using Routes (Legacy)

Routes are a lower-level configuration that give more control but are generally more complex to work with.

```json
{
  "routes": [
    { "src": "/api/(.*)", "dest": "/api/index.js" },
    { "handle": "filesystem" },
    { "src": "/(.*)", "dest": "/index.html" }
  ]
}
```

Routes provide additional features like:
- Request method filtering
- Header manipulation
- Status code control
- More complex routing patterns

## Best Practices

1. **Choose one approach**: Either use `rewrites` or `routes`, not both
2. **Start with rewrites**: For most applications, `rewrites` are simpler and sufficient
3. **Use routes if you need more control**: Only use routes if you need its advanced capabilities

## For Local Cooks Application

For our application, we've chosen to use `rewrites` because:
1. It provides all the routing functionality we need
2. It's more maintainable and readable
3. It's the recommended approach by Vercel

Our configuration correctly routes API requests to the serverless function and all other requests to the frontend SPA.