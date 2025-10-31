---
title: C# Code Examples
category: Examples
order: 1
tags: csharp, examples, syntax-highlighting, metadata
---
# C# Code Examples

This document demonstrates comprehensive C# code examples with rich metadata, interactive features, and professional styling.

## Basic Examples

### Simple Console Application

```csharp{
title: "Hello World Console App"
description: "A simple console application demonstrating basic C# syntax"
framework: "NET8"
difficulty: "BEGINNER"
filename: "Program.cs"
}
using System;

namespace HelloWorld {
    class Program {
        static void Main(string[] args) {
            Console.WriteLine("Hello, World!");
            Console.WriteLine("Welcome to enhanced C# code viewing!");
            
            var message = GetWelcomeMessage("Developer");
            Console.WriteLine(message);
        }
        
        static string GetWelcomeMessage(string name) {
            return $"Hello, {name}! Today is {DateTime.Now:yyyy-MM-dd}";
        }
    }
}
```

### Basic Class Example

```csharp{
title: "Person Class"
description: "Simple class with properties and methods"
category: "ENTITY"
difficulty: "BEGINNER"
tags: ["Class", "Properties", "Methods"]
filename: "Person.cs"
}
public class Person {
    public string Name { get; set; }
    public int Age { get; set; }
    public string Email { get; set; }
    
    public Person(string name, int age, string email) {
        Name = name;
        Age = age;
        Email = email;
    }
    
    public void DisplayInfo() {
        Console.WriteLine($"Name: {Name}");
        Console.WriteLine($"Age: {Age}");
        Console.WriteLine($"Email: {Email}");
    }
    
    public bool IsAdult() {
        return Age >= 18;
    }
}
```

### NuGet Package Example

```csharp{
title: "JSON Serialization Example"
description: "Using Newtonsoft.Json for JSON operations"
framework: "NET8"
difficulty: "INTERMEDIATE"
tags: ["JSON", "Serialization", "NuGet"]
nugetPackages: ["Newtonsoft.Json"]
filename: "JsonExample.cs"
}
using Newtonsoft.Json;
using System.Collections.Generic;

public class JsonExample {
    public void SerializeExample() {
        var person = new Person("John Doe", 30, "john@example.com");
        
        // Serialize to JSON
        string json = JsonConvert.SerializeObject(person, Formatting.Indented);
        Console.WriteLine("Serialized JSON:");
        Console.WriteLine(json);
        
        // Deserialize from JSON
        var deserializedPerson = JsonConvert.DeserializeObject<Person>(json);
        Console.WriteLine("\nDeserialized object:");
        deserializedPerson.DisplayInfo();
    }
}
```

## Advanced Examples

### Basic API Controller Example

```csharp{
title: "User Management API Controller"
description: "A comprehensive REST API controller for user management with CRUD operations"
framework: "NET8"
category: "API"
difficulty: "INTERMEDIATE"
tags: ["Web API", "REST", "CRUD", "Authentication"]
githubUrl: "https://github.com/example/user-api"
docsUrl: "https://docs.microsoft.com/aspnet/core/web-api"
nugetPackages: ["Microsoft.AspNetCore.Mvc", "Microsoft.EntityFrameworkCore", "Microsoft.AspNetCore.Authorization"]
filename: "UserController.cs"
showLineNumbers: true
showLinesOnly: [1, 2, 3, 8, 9, 12, 13, 14, 15, 18, 19] 
highlightLines: [12, 15, 28, 45]
usingStatements: ["Microsoft.AspNetCore.Mvc", "Microsoft.EntityFrameworkCore", "Microsoft.AspNetCore.Authorization", "System.Threading.Tasks", "System.Collections.Generic"]
}
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Microsoft.AspNetCore.Authorization;

namespace UserManagement.Controllers
{
    [ApiController]
    [Route("api/[controller]")]
    [Authorize]
    public class UserController : ControllerBase
    {
        private readonly UserDbContext _context;
        private readonly ILogger<UserController> _logger;

        public UserController(UserDbContext context, ILogger<UserController> logger)
        {
            _context = context;
            _logger = logger;
        }

        [HttpGet]
        public async Task<ActionResult<IEnumerable<UserDto>>> GetUsers()
        {
            try
            {
                var users = await _context.Users
                    .Where(u => u.IsActive)
                    .Select(u => new UserDto
                    {
                        Id = u.Id,
                        Name = u.Name,
                        Email = u.Email,
                        CreatedAt = u.CreatedAt
                    })
                    .ToListAsync();

                return Ok(users);
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Error retrieving users");
                return StatusCode(500, "Internal server error");
            }
        }

        [HttpGet("{id}")]
        public async Task<ActionResult<UserDto>> GetUser(int id)
        {
            var user = await _context.Users.FindAsync(id);
            
            if (user == null)
            {
                return NotFound($"User with ID {id} not found");
            }

            return Ok(new UserDto
            {
                Id = user.Id,
                Name = user.Name,
                Email = user.Email,
                CreatedAt = user.CreatedAt
            });
        }

        [HttpPost]
        public async Task<ActionResult<UserDto>> CreateUser([FromBody] CreateUserRequest request)
        {
            if (!ModelState.IsValid)
            {
                return BadRequest(ModelState);
            }

            var user = new User
            {
                Name = request.Name,
                Email = request.Email,
                CreatedAt = DateTime.UtcNow,
                IsActive = true
            };

            _context.Users.Add(user);
            await _context.SaveChangesAsync();

            var userDto = new UserDto
            {
                Id = user.Id,
                Name = user.Name,
                Email = user.Email,
                CreatedAt = user.CreatedAt
            };

            return CreatedAtAction(nameof(GetUser), new { id = user.Id }, userDto);
        }
    }
}
```

## Entity Framework Model Example

```csharp{
title: "User Entity Model"
description: "Entity Framework model with relationships and validation attributes"
framework: "NET8"
category: "ENTITY"
difficulty: "BEGINNER"
tags: ["Entity Framework", "Models", "Data Annotations"]
nugetPackages: ["Microsoft.EntityFrameworkCore", "System.ComponentModel.Annotations"]
filename: "User.cs"
}
using System.ComponentModel.DataAnnotations;
using System.ComponentModel.DataAnnotations.Schema;

namespace UserManagement.Models
{
    [Table("Users")]
    public class User
    {
        [Key]
        [DatabaseGenerated(DatabaseGeneratedOption.Identity)]
        public int Id { get; set; }

        [Required]
        [StringLength(100, MinimumLength = 2)]
        public string Name { get; set; } = string.Empty;

        [Required]
        [EmailAddress]
        [StringLength(255)]
        public string Email { get; set; } = string.Empty;

        [Required]
        public DateTime CreatedAt { get; set; }

        public DateTime? UpdatedAt { get; set; }

        [Required]
        public bool IsActive { get; set; } = true;

        // Navigation properties
        public virtual ICollection<UserRole> UserRoles { get; set; } = new List<UserRole>();
        public virtual ICollection<UserProfile> UserProfiles { get; set; } = new List<UserProfile>();
    }

    public class UserDto
    {
        public int Id { get; set; }
        public string Name { get; set; } = string.Empty;
        public string Email { get; set; } = string.Empty;
        public DateTime CreatedAt { get; set; }
    }

    public class CreateUserRequest
    {
        [Required]
        [StringLength(100, MinimumLength = 2)]
        public string Name { get; set; } = string.Empty;

        [Required]
        [EmailAddress]
        public string Email { get; set; } = string.Empty;
    }
}
```

## Advanced Service Pattern Example

```csharp{
title: "User Service with Repository Pattern"
description: "Implementation of service layer with dependency injection and error handling"
framework: "NET8"
category: "SERVICE"
difficulty: "ADVANCED"
tags: ["Service Pattern", "Repository", "Dependency Injection", "Error Handling"]
githubUrl: "https://github.com/example/user-service"
nugetPackages: ["Microsoft.Extensions.Logging", "AutoMapper"]
filename: "UserService.cs"
showLinesOnly: [1, 2, 3, 4, 9, 10, 11, 12, 13, 14, 15, 20, 21, 22, 23, 24, 25]
collapsible: false
}
using AutoMapper;
using Microsoft.Extensions.Logging;
using UserManagement.Models;
using UserManagement.Repositories;
using UserManagement.Exceptions;

namespace UserManagement.Services
{
    public interface IUserService
    {
        Task<IEnumerable<UserDto>> GetAllUsersAsync();
        Task<UserDto?> GetUserByIdAsync(int id);
        Task<UserDto> CreateUserAsync(CreateUserRequest request);
        Task<UserDto?> UpdateUserAsync(int id, UpdateUserRequest request);
        Task<bool> DeleteUserAsync(int id);
        Task<bool> UserExistsAsync(string email);
    }

    public class UserService : IUserService
    {
        private readonly IUserRepository _userRepository;
        private readonly IMapper _mapper;
        private readonly ILogger<UserService> _logger;

        public UserService(
            IUserRepository userRepository,
            IMapper mapper,
            ILogger<UserService> logger)
        {
            _userRepository = userRepository ?? throw new ArgumentNullException(nameof(userRepository));
            _mapper = mapper ?? throw new ArgumentNullException(nameof(mapper));
            _logger = logger ?? throw new ArgumentNullException(nameof(logger));
        }

        public async Task<IEnumerable<UserDto>> GetAllUsersAsync()
        {
            try
            {
                _logger.LogInformation("Retrieving all active users");
                
                var users = await _userRepository.GetActiveUsersAsync();
                var userDtos = _mapper.Map<IEnumerable<UserDto>>(users);
                
                _logger.LogInformation("Retrieved {UserCount} active users", users.Count());
                return userDtos;
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Error occurred while retrieving users");
                throw new ServiceException("Failed to retrieve users", ex);
            }
        }

        public async Task<UserDto?> GetUserByIdAsync(int id)
        {
            try
            {
                _logger.LogInformation("Retrieving user with ID: {UserId}", id);
                
                var user = await _userRepository.GetByIdAsync(id);
                if (user == null)
                {
                    _logger.LogWarning("User with ID {UserId} not found", id);
                    return null;
                }

                var userDto = _mapper.Map<UserDto>(user);
                _logger.LogInformation("Successfully retrieved user: {UserEmail}", user.Email);
                
                return userDto;
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Error occurred while retrieving user with ID: {UserId}", id);
                throw new ServiceException($"Failed to retrieve user with ID: {id}", ex);
            }
        }

        public async Task<UserDto> CreateUserAsync(CreateUserRequest request)
        {
            try
            {
                _logger.LogInformation("Creating new user with email: {Email}", request.Email);

                // Check if user already exists
                if (await UserExistsAsync(request.Email))
                {
                    throw new DuplicateUserException($"User with email {request.Email} already exists");
                }

                var user = _mapper.Map<User>(request);
                user.CreatedAt = DateTime.UtcNow;
                user.IsActive = true;

                var createdUser = await _userRepository.CreateAsync(user);
                var userDto = _mapper.Map<UserDto>(createdUser);

                _logger.LogInformation("Successfully created user with ID: {UserId}", createdUser.Id);
                return userDto;
            }
            catch (DuplicateUserException)
            {
                throw; // Re-throw business logic exceptions
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Error occurred while creating user with email: {Email}", request.Email);
                throw new ServiceException("Failed to create user", ex);
            }
        }

        public async Task<bool> UserExistsAsync(string email)
        {
            try
            {
                return await _userRepository.ExistsByEmailAsync(email);
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Error checking if user exists with email: {Email}", email);
                throw new ServiceException("Failed to check user existence", ex);
            }
        }
    }
}
```

## Middleware Configuration Example

```csharp{
title: "Custom Authentication Middleware"
description: "JWT authentication middleware with custom claims handling"
framework: "NET8"
category: "MIDDLEWARE"
difficulty: "ADVANCED"
tags: ["Middleware", "JWT", "Authentication", "Security"]
docsUrl: "https://docs.microsoft.com/aspnet/core/fundamentals/middleware"
nugetPackages: ["Microsoft.AspNetCore.Authentication.JwtBearer", "System.IdentityModel.Tokens.Jwt"]
filename: "JwtAuthenticationMiddleware.cs"
}
using Microsoft.AspNetCore.Authentication;
using Microsoft.Extensions.Options;
using System.IdentityModel.Tokens.Jwt;
using System.Security.Claims;
using System.Text.Encodings.Web;
using Microsoft.IdentityModel.Tokens;
using System.Text;

namespace UserManagement.Middleware
{
    public class JwtAuthenticationMiddleware
    {
        private readonly RequestDelegate _next;
        private readonly JwtSettings _jwtSettings;
        private readonly ILogger<JwtAuthenticationMiddleware> _logger;

        public JwtAuthenticationMiddleware(
            RequestDelegate next,
            IOptions<JwtSettings> jwtSettings,
            ILogger<JwtAuthenticationMiddleware> logger)
        {
            _next = next;
            _jwtSettings = jwtSettings.Value;
            _logger = logger;
        }

        public async Task InvokeAsync(HttpContext context)
        {
            var token = ExtractTokenFromHeader(context);
            
            if (!string.IsNullOrEmpty(token))
            {
                await ValidateAndSetUser(context, token);
            }

            await _next(context);
        }

        private string? ExtractTokenFromHeader(HttpContext context)
        {
            var authHeader = context.Request.Headers["Authorization"].FirstOrDefault();
            
            if (authHeader != null && authHeader.StartsWith("Bearer "))
            {
                return authHeader.Substring("Bearer ".Length).Trim();
            }

            return null;
        }

        private async Task ValidateAndSetUser(HttpContext context, string token)
        {
            try
            {
                var tokenHandler = new JwtSecurityTokenHandler();
                var key = Encoding.ASCII.GetBytes(_jwtSettings.SecretKey);

                var validationParameters = new TokenValidationParameters
                {
                    ValidateIssuerSigningKey = true,
                    IssuerSigningKey = new SymmetricSecurityKey(key),
                    ValidateIssuer = true,
                    ValidIssuer = _jwtSettings.Issuer,
                    ValidateAudience = true,
                    ValidAudience = _jwtSettings.Audience,
                    ValidateLifetime = true,
                    ClockSkew = TimeSpan.Zero
                };

                var principal = tokenHandler.ValidateToken(token, validationParameters, out SecurityToken validatedToken);
                
                // Set the user context
                context.User = principal;
                
                _logger.LogInformation("JWT token validated successfully for user: {UserId}", 
                    principal.FindFirst(ClaimTypes.NameIdentifier)?.Value);
            }
            catch (SecurityTokenException ex)
            {
                _logger.LogWarning("Invalid JWT token: {Error}", ex.Message);
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Error validating JWT token");
            }
        }
    }

    public class JwtSettings
    {
        public string SecretKey { get; set; } = string.Empty;
        public string Issuer { get; set; } = string.Empty;
        public string Audience { get; set; } = string.Empty;
        public int ExpirationMinutes { get; set; } = 60;
    }
}
```

## Configuration and Startup Example

```csharp{
title: "Program.cs Configuration"
description: "Modern .NET 8 minimal hosting model with comprehensive service configuration"
framework: "NET8"
category: "CONFIG"
difficulty: "INTERMEDIATE"
tags: ["Configuration", "Dependency Injection", "Startup", "Minimal API"]
filename: "Program.cs"
}
using Microsoft.EntityFrameworkCore;
using Microsoft.AspNetCore.Authentication.JwtBearer;
using Microsoft.IdentityModel.Tokens;
using System.Text;
using UserManagement.Data;
using UserManagement.Services;
using UserManagement.Repositories;
using UserManagement.Middleware;

var builder = WebApplication.CreateBuilder(args);

// Configuration
var jwtSettings = builder.Configuration.GetSection("JwtSettings");
var connectionString = builder.Configuration.GetConnectionString("DefaultConnection");

// Add services to the container
builder.Services.AddDbContext<UserDbContext>(options =>
    options.UseSqlServer(connectionString));

// JWT Authentication
builder.Services.Configure<JwtSettings>(jwtSettings);
builder.Services.AddAuthentication(JwtBearerDefaults.AuthenticationScheme)
    .AddJwtBearer(options =>
    {
        options.TokenValidationParameters = new TokenValidationParameters
        {
            ValidateIssuerSigningKey = true,
            IssuerSigningKey = new SymmetricSecurityKey(
                Encoding.ASCII.GetBytes(jwtSettings["SecretKey"]!)),
            ValidateIssuer = true,
            ValidIssuer = jwtSettings["Issuer"],
            ValidateAudience = true,
            ValidAudience = jwtSettings["Audience"],
            ValidateLifetime = true,
            ClockSkew = TimeSpan.Zero
        };
    });

builder.Services.AddAuthorization();

// Register application services
builder.Services.AddScoped<IUserRepository, UserRepository>();
builder.Services.AddScoped<IUserService, UserService>();

// AutoMapper
builder.Services.AddAutoMapper(typeof(Program));

// API Controllers
builder.Services.AddControllers();

// API Documentation
builder.Services.AddEndpointsApiExplorer();
builder.Services.AddSwaggerGen(c =>
{
    c.SwaggerDoc("v1", new() { Title = "User Management API", Version = "v1" });
    c.AddSecurityDefinition("Bearer", new()
    {
        Description = "JWT Authorization header using the Bearer scheme.",
        Name = "Authorization",
        In = Microsoft.OpenApi.Models.ParameterLocation.Header,
        Type = Microsoft.OpenApi.Models.SecuritySchemeType.Http,
        Scheme = "bearer"
    });
});

// CORS
builder.Services.AddCors(options =>
{
    options.AddPolicy("AllowSpecificOrigins", policy =>
    {
        policy.WithOrigins("https://localhost:4200", "https://myapp.com")
              .AllowAnyHeader()
              .AllowAnyMethod();
    });
});

// Logging
builder.Services.AddLogging(config =>
{
    config.AddConsole();
    config.AddDebug();
});

var app = builder.Build();

// Configure the HTTP request pipeline
if (app.Environment.IsDevelopment())
{
    app.UseSwagger();
    app.UseSwaggerUI();
    app.UseDeveloperExceptionPage();
}

app.UseHttpsRedirection();
app.UseCors("AllowSpecificOrigins");

// Custom JWT middleware
app.UseMiddleware<JwtAuthenticationMiddleware>();

app.UseAuthentication();
app.UseAuthorization();

app.MapControllers();

app.Run();
```

This documentation showcases the enhanced C# code viewing capabilities with:

- **Rich Metadata**: Titles, descriptions, framework versions, categories, difficulty levels
- **Interactive Features**: Copy, download, GitHub links, NuGet package integration
- **Visual Enhancements**: Syntax highlighting, line numbers, code folding
- **Professional Styling**: VS Code-inspired themes, hover effects, responsive design
- **Developer Tools**: Line highlighting, collapsible sections, tag categorization
