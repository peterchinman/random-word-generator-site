<!DOCTYPE html>
<html>
<head>
	<meta charset="utf-8">
	<meta name="viewport" content="width=device-width, initial-scale=1">
	<title>Random Word Generator</title>

	<link rel="preconnect" href="https://fonts.googleapis.com">
	<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
	<link href="https://fonts.googleapis.com/css2?family=Roboto+Mono:wght@100..700&display=swap" rel="stylesheet">

	<meta name="description" content="A Random Word Generator">
	<meta property="og:image" content="[[Insert Absolute Path]]">

	<link href="css/style.css" rel="stylesheet">
	
</head>

<body class="cute light">

<header>
	<div class="topbar">
		<inner-column>
			<ul class="option-sliders">
					<li class="option-slider">
						<span id="light">light</span>
						<label class="switch-container">
							<input type="checkbox" id="light-dark" aria-describedby="light dark" />
							<div class="slider round"></div>
						</label>
						<span id="dark">dark</span>
					</li>
					<li class="option-slider">
						<span id="cute">cute</span>
						<label class="switch-container">
							<input type="checkbox" id="cute-serious" aria-describedby="cute serious"/>
							<div class="slider round"></div>
						</label>
						<span id="serious">serious</span>
					</li>
			</ul>
		</inner-column>
	</div>
<inner-column>
	<h1 class="title">Random Word Generator</h1>
</inner-column>
</header>

<main>
	<form id="random word options" method="post">
		<inner-column>
			<fieldset class="options">
				<legend>Number of words to generate</legend>
				<label>10<input type="radio" name="number-words" value="10"></label>
				<label>15<input type="radio" name="number-words" value="15" checked></label>
				<label>25<input type="radio" name="number-words" value="25"></label>
				<label>40<input type="radio" name="number-words" value="40"></label>
			</fieldset>
			<details id="filters">
				<summary>
					Filters
					<svg class="option-arrow-svg" width="10" height="10" viewBox="0 0 10 10" fill="none" xmlns="http://www.w3.org/2000/svg">
						<path d="M1.5 1.21094L7.5 4.99993L1.5 8.78892" stroke="black" stroke-width="2" stroke-linecap="round"/>
					</svg>
				</summary>
				<fieldset class="options">
					<legend>Parts of Speech</legend>
					<label>noun<input type="checkbox" name="parts-of-speech" value="noun"></label>
					<label>verb<input type="checkbox" name="parts-of-speech" value="verb"></label>
					<label>adj<input type="checkbox" name="parts-of-speech" value="adjective"></label>
					<label>adv<input type="checkbox" name="parts-of-speech" value="adverb"></label>
				</fieldset>
				<fieldset class="min-max">
					<legend>Word Length</legend>
					<div class="number-input">
						<button class="decrement crement">
							<svg class="decrement-svg" width="18" height="15" viewBox="0 0 18 15" fill="none" xmlns="http://www.w3.org/2000/svg">
								<path d="M17 1L9 13L1 0.999999" stroke="black" stroke-width="2" stroke-linecap="round"/>
							</svg>

						</button>
						<label for=""><span>min</span>
							<input type="number" min="1" max="45" name="min-word-length">
						</label>
						<button class="increment crement">
							<svg class="increment-svg" width="18" height="15" viewBox="0 0 18 15" fill="none" xmlns="http://www.w3.org/2000/svg">
								<path d="M1 14L9 2L17 14" stroke="black" stroke-width="2" stroke-linecap="round"/>
							</svg>
						</button>
					</div>
					<div class="number-input">
						<button class="decrement crement">
							<svg class="decrement-svg" width="18" height="15" viewBox="0 0 18 15" fill="none" xmlns="http://www.w3.org/2000/svg">
								<path d="M17 1L9 13L1 0.999999" stroke="black" stroke-width="2" stroke-linecap="round"/>
							</svg>
						</button>
						<label for=""><span>max</span>
							<input type="number" min="1" max="45" name="max-word-length">
						</label>
						<button class="increment crement">
							<svg class="increment-svg" width="18" height="15" viewBox="0 0 18 15" fill="none" xmlns="http://www.w3.org/2000/svg">
								<path d="M1 14L9 2L17 14" stroke="black" stroke-width="2" stroke-linecap="round"/>
							</svg>
						</button>
					</div>
				</fieldset>
			</details>
			<fieldset class="buttons">
				<button id="generate">Generate</button>
				<button id="reset">Reset</button>
			</fieldset>
		</inner-column>
	</form>

	<div id="results">
		<section class="word-sections empty" id="generated-words">
			<inner-column>
				<h2 class="attention-voice"><span id="number-of-words"></span> Random Words</h2>
				<word-list id="generated-words-list">
		
				</word-list>
				<p>click on a word for a definition</p>
			</inner-column>
		</section>
		<section class="word-sections empty" id="saved-words">
			<inner-column>
				<div class="upper-part">
					<h2 class="loud-voice">Saved Words</h2>
					<div class="tools">
						<button id="clear-saved-words">Clear</button>
						<button id="copy-saved-words">Copy</button>
					</div>
				</div>
		
				<word-list id="saved-words-list">
		
				</word-list>
		
			</inner-column>
		</section>
	</div>



</main>


<script src="javascript/javascript.js"></script>

</body>

</html>


<!--
<definition-panel>
	<div class="tools">
		<div class="x-out-div">
			<svg class="x-out-path" width="32" height="32" viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg" >
				<path  d="M1 1L31 31M1 31L31 1" stroke-width="2" stroke-linecap="round"/>
			</svg>
		</div>
		
		<div class="bookmark">
			<svg class=" bookmark-svg" width="31" height="43" viewBox="0 0 31 43" fill="none" xmlns="http://www.w3.org/2000/svg">
				<path  d="M2.5 0.5H28.5C29.3284 0.5 30 1.17157 30 2V37.6688C30 39.0521 28.2868 39.6981 27.3734 38.6591L17.3776 27.2887C16.382 26.1562 14.618 26.1562 13.6224 27.2887L3.62657 38.6591C2.71323 39.6981 1 39.0521 1 37.6688V2C1 1.17157 1.67157 0.5 2.5 0.5Z"  stroke-linecap="square" stroke-linejoin="round"/>
			</svg>

		</div>
	</div>
	<h3 class="attention-voice">Example</h3>
	<ol class="definitions">
		<li>
			<p>noun, an example of examples</p>
			<p>synonym: example</p>
		</li>
		<li>
			<p>noun, another example of exampling</p>
		</li>
		<li>
			<p>noun, further example of what an example might exemplify</p>
		</li>
	</ol>
</definition-panel>

-->
