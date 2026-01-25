/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ["./index.html"],
  theme: {
    extend: {
      colors: {
        cardinalRed: '#D92323', // Your official brand color
      },
    },
  },
  plugins: [],
}
```.

### 2. Update `input.css` (Optional for v4)
If you prefer keeping variables in your CSS file, you can also define it there:

```css
@import "tailwindcss";

@theme {
  --color-cardinal-red: #D92323;
}
```.

### 3. Re-Run the "Force" Build
Since you changed the config, you must re-run your build command to "bake" the new color into your `style.css`:

```powershell
./tailwind.exe -i input.css -o style.css --minify
```.



### 4. Use it in your HTML
Now you can replace the generic `bg-red-700` or `text-red-700` with your exact brand color:
* Change the "Fetch & Format" button to: `class="... bg-cardinalRed ..."`.
* Change the Search Modal spinner to: `class="... text-cardinalRed ..."`.

**Your environment is now fully professional and brand-aligned.** Would you like me to help you create a final "History" cleanup script that removes batches older than 30 days to keep your database tidy?
