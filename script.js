  // Suppress pdf.js warnings
        pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/2.16.105/pdf.worker.min.js';
        pdfjsLib.verbosity = pdfjsLib.VerbosityLevel.ERRORS;

        const API_ENDPOINT = 'https://api.nucleus.ai/talk2docs';
        const API_TOKEN = 'YOUR_ACCESS_TOKEN'; // Replace with your Nucleus AI API token

        async function extractTextFromPDF(file) {
            try {
                const pdf = await pdfjsLib.getDocument({ data: await file.arrayBuffer() }).promise;
                let text = '';
                for (let i = 1; i <= pdf.numPages; i++) {
                    const page = await pdf.getPage(i);
                    const content = await page.getTextContent();
                    text += content.items.map(item => item.str).join(' ') + ' ';
                }
                text = text.trim();
                if (text.length < 50 || !/[a-zA-Z]{10}/.test(text)) {
                    text = await extractTextFromPDFImages(pdf, file.name);
                }
                if (!text) throw new Error(`No text extracted from ${file.name}`);
                return text;
            } catch (error) {
                throw new Error(`PDF processing failed: ${error.message}`);
            }
        }

        async function extractTextFromPDFImages(pdf, fileName) {
            let text = '';
            for (let i = 1; i <= pdf.numPages; i++) {
                const page = await pdf.getPage(i);
                const viewport = page.getViewport({ scale: 2.0 });
                const canvas = document.createElement('canvas');
                canvas.height = viewport.height;
                canvas.width = viewport.width;
                await page.render({ canvasContext: canvas.getContext('2d'), viewport }).promise;
                const { data: { text: ocrText } } = await Tesseract.recognize(canvas, 'eng');
                text += ocrText + ' ';
                canvas.remove();
            }
            return text.trim();
        }

        async function analyzeResume(resumeText, skills, mandatorySkills, minExperience) {
            const prompt = `
                Analyze resume. If mandatory skills exist, all must match and experience must meet minimum. Otherwise, at least one required skill must match and meet minimum experience.
                Required skills: ${skills || 'None'}
                Mandatory skills: ${mandatorySkills || 'None'}
                Minimum experience: ${minExperience} years
                Resume: ${resumeText.substring(0, 4000)}...
                Return JSON: { match: boolean, allSkills: string[], missingSkills: string[], experienceYears: number, experienceMonths: number, address: string, previousCompanies: string[], numberOfCompanies: number, lastCompany: string, summary: string }
            `;
            const payload = {
                question: prompt,
                documentId: 'resume_temp_id' // Placeholder; replace with actual document ID if required
            };
            const headers = {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${API_TOKEN}`
            };

            try {
                const response = await axios.post(API_ENDPOINT, payload, { headers });
                const text = response.data; // Adjust based on actual Nucleus AI response format
                return JSON.parse(text.match(/{[\s\S]*}/)[0]);
            } catch (error) {
                throw new Error(error.response?.data?.error?.message || error.message);
            }
        }

        async function downloadSelectedResumes() {
            const selected = document.querySelectorAll('.resume-checkbox:checked');
            if (!selected.length) return;
            const zip = new JSZip();
            await Promise.all(Array.from(selected).map(async cb => zip.file(cb.dataset.file, await (await fetch(cb.dataset.url)).blob())));
            saveAs(await zip.generateAsync({ type: 'blob' }), 'selected_resumes.zip');
        }

        async function filterResumes() {
            const skills = document.getElementById('skills').value.trim();
            const mandatorySkills = document.getElementById('mandatory-skills').value.trim();
            const minExperience = parseInt(document.getElementById('experience').value);
            const resumeFiles = document.getElementById('resumes').files;
            const results = document.getElementById('results');
            const error = document.getElementById('error');
            const loading = document.getElementById('loading');
            const downloadButtons = document.getElementById('download-buttons');
            const progressBar = document.getElementById('progress-bar');
            const progressPercentage = document.getElementById('progress-percentage');

            if (!skills && !mandatorySkills || isNaN(minExperience) || !resumeFiles.length) {
                error.textContent = 'Provide skills, experience, and at least one resume.';
                error.style.display = 'block';
                return;
            }

            error.style.display = 'none';
            results.innerHTML = '';
            downloadButtons.style.display = 'none';
            loading.style.display = 'block';

            const matchingResumes = [];
            let processed = 0;
            for (const file of resumeFiles) {
                try {
                    const text = await extractTextFromPDF(file);
                    const analysis = await analyzeResume(text, skills, mandatorySkills, minExperience);
                    if (analysis.match) matchingResumes.push({ file, analysis });
                } catch (error) {
                    error.textContent = error.message.includes('rate limit') ? 'API rate limit exceeded. Try again later.' : error.message;
                    error.style.display = 'block';
                    loading.style.display = 'none';
                    return;
                }
                processed++;
                progressBar.style.width = `${(processed / resumeFiles.length) * 100}%`;
                progressPercentage.textContent = `${Math.round((processed / resumeFiles.length) * 100)}%`;
            }

            loading.style.display = 'none';
            progressBar.style.width = '0%';
            progressPercentage.textContent = '0%';
            if (!matchingResumes.length) {
                results.innerHTML = '<div class="alert alert-info" role="alert">No resumes matched the criteria.</div>';
                return;
            }

            downloadButtons.style.display = 'block';
            const fragment = document.createDocumentFragment();
            matchingResumes.forEach(({ file, analysis }) => {
                const url = URL.createObjectURL(new Blob([file], { type: 'application/pdf' }));
                const div = document.createElement('div');
                div.className = 'card mb-3';
                div.innerHTML = `
                    <div class="card-body">
                        <div class="form-check mb-3">
                            <input type="checkbox" class="form-check-input resume-checkbox" data-file="${file.name}" data-url="${url}" id="checkbox-${file.name}">
                            <label class="form-check-label" for="checkbox-${file.name}">
                                <strong>Resume:</strong> ${file.name}
                            </label>
                        </div>
                        <hr>
                        <p class="mb-2"><strong>Experience:</strong> ${analysis.experienceYears || 0} years${analysis.experienceMonths ? `, ${analysis.experienceMonths} months` : ''}</p>
                        <p class="mb-2"><strong>Skills:</strong> ${analysis.allSkills?.join(', ') || 'None'}</p>
                        <p class="mb-2"><strong>Missing Skills:</strong> ${analysis.missingSkills?.join(', ') || 'None'}</p>
                        <p class="mb-2"><strong>Address:</strong> ${analysis.address || 'Not specified'}</p>
                        <p class="mb-2"><strong>Companies:</strong> ${analysis.previousCompanies?.join(', ') || 'Not specified'}</p>
                        <p class="mb-0"><strong>Summary:</strong> ${analysis.summary || 'No summary'}</p>
                    </div>
                `;
                fragment.appendChild(div);
            });
            results.appendChild(fragment);

            document.querySelectorAll('.resume-checkbox').forEach(cb => cb.addEventListener('change', () => {
                document.getElementById('download-selected').disabled = !document.querySelectorAll('.resume-checkbox:checked').length;
            }));
            document.getElementById('download-selected').addEventListener('click', downloadSelectedResumes);
        }

        document.addEventListener('DOMContentLoaded', () => {
            document.getElementById('filter-button').addEventListener('click', filterResumes);
        });
