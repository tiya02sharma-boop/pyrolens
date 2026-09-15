# AGNI pipeline — split notebooks

## Dashboard + API

The Pyrolens dashboard is now connected to this project's trained XGBoost model and verified FIRMS output, rather than browser-generated mock data.

Install the Python and frontend dependencies, then run the API and Vite in two terminals:

```bash
pip install -r requirements.txt
python -m uvicorn app:app --reload
```

```bash
npm install
npm run dev
```

Open `http://localhost:5173`. The Vite dev server forwards `/api` to `http://127.0.0.1:8000`; a production `npm run build` is served by the same API application at `http://127.0.0.1:8000`.

The classifier endpoint accepts latitude, longitude, FRP, and optional brightness. Because Sentinel-2 and geographic-context features are not entered in the panel, it uses the nearest historic FIRMS observation for those real-model features and clearly returns that provenance with the prediction.

## Optional PostGIS storage

The project also includes a spatial-storage layer under [`gis/`](gis/). Configure `DATABASE_URL`, apply [`gis/01_schema.sql`](gis/01_schema.sql), then run `python gis/02_load_data.py` to serve map detections from PostGIS. This enables spatial-radius lookups at `/api/detections/nearby` and database-side regional summaries at `/api/regions/summary`.

Without `DATABASE_URL`, the dashboard and model continue to run against the verified CSV output, so PostgreSQL is not required for local use.

## Project structure

```
AGNI/
├── notebooks/              01-05 split notebooks, ready to run in order
│   ├── firms_india_50k_satellite.csv   (raw data, correctly named for the code)
│   └── firms_us_50k_satellite.csv
├── data/                    raw data (original filenames + correctly-renamed copies)
├── models/                  trained models/encoders from the verified run
├── outputs/                 plots + predictions CSV from the verified run
├── original_pipeline/       the original single train_pipeline_v2.ipynb / .py, for reference
├── requirements.txt
└── README.md
```

Just open `notebooks/` in Jupyter and run `01_eda.ipynb` → `05_evaluation.ipynb` in order — the raw
CSVs are already sitting next to them under the filenames the code expects, and each notebook
saves the intermediate files (`eda_output_combined.csv`, `fe_*.joblib`, etc.) the next one needs
into that same folder.


The original `train_pipeline_v2.ipynb` has been divided into 5 notebooks, run in this order:

1. **01_eda.ipynb** — loads the raw India/US FIRMS CSVs, combines them, and inspects the class
   distribution (incl. dropping `unlabeled` rows from the training pool).
2. **02_preprocessing.ipynb** — cleans/imputes the Sentinel-2 satellite bands & indices (regional
   median imputation, missing-data flag).
3. **03_feature_engineering.ipynb** — derived satellite flags, date/categorical encoding, final
   feature matrix assembly, and the leakage-safe spatial-block train/test split.
4. **04_model_training.ipynb** — trains XGBoost (primary), Random Forest (baseline), and Isolation
   Forest (persistence/anomaly layer); saves all models, encoders, and the predictions dataframe.
5. **05_evaluation.ipynb** — train-vs-test accuracy/F1 (overfitting check), feature importance,
   confusion matrix, and the final summary.

**Every original code cell is unchanged** — same variable names, same logic, same model
hyperparameters. The only additions are small "glue" cells (clearly marked
`# --- Notebook-chaining glue code ---`) at the start/end of each notebook that save/load the
intermediate dataframe, train/test splits, models, and predictions to/from disk so each notebook
can run independently in sequence, instead of one 700-line monolith.

Run the notebooks in numeric order from the same working directory — each one reads files written
by the previous one (`eda_output_combined.csv`, `preprocessing_output.csv`, `fe_*.joblib`,
`train_*.joblib`, etc.) and the final model/plot filenames (`model_xgboost_v2.joblib`,
`confusion_matrix_v2.png`, ...) match the originals exactly.

**Note on raw data filenames:** the original notebook reads `firms_india_50k_satellite.csv` and
`firms_us_50k_satellite.csv`. In this project those files are shipped as
`firms_india_50k_FINAL_with_sentinel2.csv.xls` and `firms_us_50k_merged_satellite.csv.xls` (both
are plain CSVs despite the `.xls`-looking name). Since the task was to keep the code exact, cell 1
of `01_eda.ipynb` still uses the original filenames — copy/rename the two data files to match
before running, as was done to verify this split executes end-to-end.

All 5 notebooks were executed top-to-bottom to confirm the pipeline still produces identical
results (same accuracy/F1 numbers, same saved models and plots) as the original single notebook.
