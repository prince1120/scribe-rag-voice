# Agent Rules & Guidelines

## Architecture & Code Quality
- **SOLID Principles**: Always follow SOLID principles when writing, refactoring, or designing code:
  1. **Single Responsibility Principle (SRP)**: Each class, module, component, or function must have one clear responsibility and reason to change.
  2. **Open/Closed Principle (OCP)**: Code structures should be open for extension but closed for modification.
  3. **Liskov Substitution Principle (LSP)**: Subtypes or interface implementations must be fully substitutable for their base abstractions without breaking functionality.
  4. **Interface Segregation Principle (ISP)**: Keep interfaces, types, and component props small, focused, and client-specific rather than monolithic.
  5. **Dependency Inversion Principle (DIP)**: High-level modules and UI components should depend on abstractions/contracts, not low-level concrete implementations.

## Personal GitHub Repository Rules (prince1120)
When setting up, cloning, or configuring Git repositories for personal account (`prince1120`):
1. **Cloning Personal Repositories**:
   Use `github.com-personal` host alias in the SSH URL:
   ```powershell
   git clone git@github.com-personal:prince1120/YOUR-REPO-NAME.git
   cd YOUR-REPO-NAME
   git config local user.name "Prince Pandey"
   git config local user.email "princepandey1120@gmail.com"
   ```
2. **Creating New Local Project & Uploading to Personal GitHub**:
   ```powershell
   git init
   git config local user.name "Prince Pandey"
   git config local user.email "princepandey1120@gmail.com"
   git add .
   git commit -m "Initial commit"
   git branch -M main
   git remote add origin git@github.com-personal:prince1120/YOUR-REPO-NAME.git
   git push -u origin main
   ```
3. **Git Configuration Rules**:
   - **Personal Projects Host**: `git@github.com-personal:prince1120/...`
   - **Work Projects Host**: `git@github.com:company/...` (standard default)
   - **Local User Name**: `"Prince Pandey"`
   - **Local User Email**: `"princepandey1120@gmail.com"`
