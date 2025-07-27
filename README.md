# Currency Translator Pro 🌐💱

A powerful Chrome extension that automatically converts currencies and translates text across 15+ languages with multiple fallback APIs for maximum reliability.

## ✨ Features

### 🔄 Multi-Currency Support

- **6 Major Currencies**: USD, EUR, GBP, JPY, CNY, KRW
- **Real-time Exchange Rates**: Fetched from multiple reliable APIs
- **Smart Detection**: Automatically detects currency symbols (¥, $, €, £, etc.)
- **Inline Conversion**: Shows converted prices directly next to original prices

### 🗣️ Multi-Language Translation

- **9 Languages Supported**: English, Spanish, French, German, Japanese, Korean, Chinese, Arabic, Russian
- **Auto-Detection**: Automatically detects text language and translates when needed
- **Contextual Translation**: Preserves original text while showing translations

### 🛡️ Reliability & Performance

- **Multiple Fallback APIs**: 3 currency APIs and 3 translation APIs for maximum uptime
- **Smart Caching**: 10-minute cache system reduces API calls and improves speed
- **Rate Limiting**: Built-in request limiting to prevent API abuse
- **Error Handling**: Comprehensive error handling with graceful fallbacks

### 🎛️ Advanced Configuration

- **Auto-Processing**: Automatically processes new content as pages load
- **Customizable Timeouts**: Adjustable message display duration
- **Statistics Tracking**: Monitor conversion and translation counts
- **Cache Management**: Manual cache clearing and cleanup

## 🚀 Installation

### From Chrome Web Store

1. Visit the Chrome Web Store (coming soon)
2. Click "Add to Chrome"
3. Follow the installation prompts

### Manual Installation (Developer Mode)

1. Download or clone this repository
2. Open Chrome and navigate to `chrome://extensions/`
3. Enable "Developer mode" in the top right
4. Click "Load unpacked" and select the extension folder
5. The extension will appear in your toolbar

## 🔧 Configuration

### Basic Settings

- **Preferred Currency**: Choose your target currency for conversions
- **Translation Language**: Select your preferred language for translations
- **Message Timeout**: Set how long status messages are displayed (1-10 seconds)

### Advanced Options

- **Process Automatically**: Enable/disable automatic processing on page load.
- **Show Statistics**: Display conversion and translation counts
- **Compact Display Mode**: Minimize visual impact of conversions
- **Show Original Text**: Keep original text visible alongside translations

## 🎯 Usage

### Automatic Processing

1. Install and configure the extension
2. Visit any webpage with prices or foreign text
3. The extension automatically detects and processes content
4. Converted prices and translations appear inline

### Manual Processing

1. Click the extension icon in your toolbar
2. Disable "Process automatically on page load" if you want to control execution.
3. Click "🔄 Process" to manually process the current page.
4. Use "🗑️ Clear Cache" to refresh all cached data.

### Example Output

```
Original: ¥1,500 for a coffee
Processed: ¥1,500 (≈ $10.45) for a coffee

Original: これは美味しいコーヒーです
Processed: これは美味しいコーヒーです (This is delicious coffee)
```

## 🔌 API Integration

### Currency APIs (with fallback)

1. **Frankfurter.app** - Primary open-source API
2. **ExchangeRate.host** - Secondary fallback

### Translation APIs (with fallback)

1. **Lingva.ml** - Primary open-source API

## 📊 Statistics & Monitoring

Track your usage with built-in statistics:

- **Conversion Count**: Total currency conversions performed
- **Translation Count**: Total text translations performed
- **Cache Efficiency**: Monitor cache hit rates
- **API Health**: Track API response times and failures

## 🛠️ Technical Details

### Architecture

- **Manifest V3**: Uses the latest Chrome extension architecture
- **Service Worker**: Efficient background processing
- **Content Script**: Lightweight DOM manipulation
- **Modern APIs**: Uses `fetch` with AbortSignal for timeout handling

### Performance Optimizations

- **WeakMap/WeakSet**: Efficient memory management for processed elements
- **Debounced Processing**: Reduces unnecessary API calls
- **Selective DOM Traversal**: Only processes relevant content
- **Smart Caching**: Balances performance with data freshness

### Security Features

- **Content Security Policy**: Strict CSP for enhanced security
- **Permission Scoping**: Minimal required permissions
- **API Rate Limiting**: Prevents abuse and quota exhaustion
- **Error Isolation**: Prevents crashes from affecting other tabs

## 🔧 Development

### File Structure

```
currency-translator-pro/
├── manifest.json          # Extension configuration
├── background.js          # Service worker
├── content.js            # Content script
├── popup.html            # Extension popup UI
├── popup.js              # Popup functionality
├── icon_16x16.png        # Extension icons
├── icon_48x48.png
├── icon_128x128.png
└── README.md             # This file
```

### Building from Source

1. Clone the repository
2. No build process required - pure JavaScript
3. Load in Chrome developer mode for testing
4. Submit to Chrome Web Store for distribution

### API Keys (Optional)

While the extension works with free APIs, you can add your own API keys for better rate limits:

- Create API keys from supported services
- Modify the API configurations in `content.js`
- Update the fallback order as needed

## 🌐 Supported Websites

The extension works on all websites that contain:

- **E-commerce sites**: Amazon, eBay, AliExpress, etc.
- **News websites**: BBC, CNN, Reuters, etc.
- **Social media**: Twitter, Facebook, Reddit, etc.
- **Forums**: Stack Overflow, GitHub, etc.
- **Any website**: With prices or foreign language text

## 🤝 Contributing

We welcome contributions! Here's how to help:

1. **Fork the repository**
2. **Create a feature branch**: `git checkout -b feature/amazing-feature`
3. **Commit your changes**: `git commit -m 'Add amazing feature'`
4. **Push to branch**: `git push origin feature/amazing-feature`
5. **Open a Pull Request**

### Development Guidelines

- Follow existing code style and patterns
- Add error handling for new API integrations
- Test thoroughly across different websites
- Update documentation for new features

## 📝 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## 🐛 Bug Reports & Support

Found a bug or need help?

1. Check existing [GitHub Issues](https://github.com/yourusername/currency-translator-pro/issues)
2. Create a new issue with detailed reproduction steps
3. Include your Chrome version and extension version
4. Provide example URLs where the issue occurs

## 🔮 Roadmap

### Version 1.4.0 (Coming Soon)

- [ ] Cryptocurrency support (BTC, ETH, etc.)
- [ ] Historical exchange rate charts
- [ ] More translation languages (15 → 25)
- [ ] Offline mode with cached rates

### Version 1.5.0 (Future)

- [ ] Custom API key support
- [ ] Advanced text formatting options
- [ ] Whitelist/blacklist for specific websites
- [ ] Dark mode for popup interface

## 📊 Version History

### v1.3.0 (Current)

- Enhanced error handling and fallback systems
- Added statistics tracking and monitoring
- Improved cache management with automatic cleanup
- Better rate limiting and API abuse prevention

### v1.2.0

- Added multi-language translation support
- Implemented smart caching system
- Enhanced UI with better status messages
- Added configuration options for auto-processing

### v1.1.0

- Multi-currency support with 6 major currencies
- Multiple fallback APIs for reliability
- Improved DOM processing efficiency
- Added manual reprocessing option

### v1.0.0

- Initial release with basic currency conversion
- Single API integration
- Basic popup interface
- Chrome extension store submission

## 🎖️ Acknowledgments

- **FawazAhmed0** for the excellent free currency API
- **Lingva.ml** for open-source translation services
- **Chrome Extensions Team** for comprehensive documentation
- **Open Source Community** for inspiration and feedback

---

**Currency Translator Pro** - Making the web more accessible, one conversion at a time! 🌍✨
